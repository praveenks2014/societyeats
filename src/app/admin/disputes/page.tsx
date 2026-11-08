'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePolledResource } from '@/lib/use-polled-resource';
import { Badge, Button, Card, EmptyState, Field, Input, Select, Skeleton, Textarea } from '@/components/ui';
import { useToast } from '@/components/providers';
import { formatINR } from '@/lib/money';

type BoardOrder = { id: number; status: string; kitchen: string; foodPaise: number; minutesInState: number };
type Ticket = { id: number; kind: string; orderId: number | null; subject: string; status: string; ackOverdue: boolean; resolveOverdue: boolean; ackHoursLeft: number | null; resolveHoursLeft: number | null };
type Board = { columns: { key: string; label: string; orders: BoardOrder[] }[]; tickets: Ticket[]; overdue: number; targets: { ackHours: number; resolveDays: number } };
type Detail = {
  ticket: { id: number; kind: string; subject: string; body: string | null; status: string; ackOverdue: boolean; resolveOverdue: boolean; evidenceJson: Record<string, unknown> | null };
  order: null | { id: number; status: string; buyerId: number; sellerId: number; buyer: string; buyerSociety: string | null; kitchen: string; foodPaise: number; feePaise: number; items: string[]; buyerClaim: { method: string | null; utr: string | null; claimedAt: string | null }; kitchenStatement: string | null };
  timeline: { status: string; note: string | null; at: string }[];
  chatMayRead: boolean;
};

const ago = (m: number) => (m < 90 ? `${m} min` : m < 2880 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} d`);

export default function DisputesBoard() {
  const [open, setOpen] = useState<number | null>(null);
  // Only the most recently started request may set the board (see usePolledResource).
  const { data: board, reload: load, abortInFlight } = usePolledResource<Board>(
    async (signal) => {
      try {
        const r = await fetch('/api/admin/disputes', { signal });
        return r.ok ? ((await r.json()) as Board) : null;
      } catch {
        return null;
      }
    },
    { intervalMs: 15_000 },
  );
  if (!board) return <Skeleton className="h-64 w-full" />;
  return (
    <div className="mx-auto max-w-5xl space-y-6" onClickCapture={abortInFlight}>
      <div>
        <h1 className="text-2xl font-bold">Disputes and live orders</h1>
        <p className="mt-1 text-sm text-ink-soft">Tickets must be acknowledged within {board.targets.ackHours} hours and resolved within {board.targets.resolveDays} days.</p>
        {board.overdue > 0 && <p className="mt-2 rounded-xl bg-chili-tint px-3 py-2 text-sm font-semibold text-chili-dark" role="alert" data-testid="overdue-tickets">{board.overdue} ticket{board.overdue === 1 ? ' is' : 's are'} past a deadline.</p>}
      </div>

      <section>
        <h2 className="mb-2 text-lg font-bold">Open tickets</h2>
        {board.tickets.length === 0 ? <EmptyState emoji="✅" title="No open tickets" /> : (
          <div className="space-y-2" data-testid="tickets">
            {board.tickets.map((t) => (
              <Card key={t.id} className={`p-3 ${t.ackOverdue || t.resolveOverdue ? 'border-chili' : ''}`} data-testid={`ticket-${t.id}`} data-overdue={t.ackOverdue || t.resolveOverdue}>
                <button className="flex w-full items-center justify-between gap-2 text-left" onClick={() => setOpen(open === t.id ? null : t.id)}>
                  <span><span className="font-semibold">#{t.id}</span> {t.subject}<span className="block text-xs text-ink-faint">{t.kind.replaceAll('_', ' ')}{t.orderId ? ` · order #${t.orderId}` : ''}</span></span>
                  <span className="flex flex-col items-end gap-1">
                    {t.ackOverdue ? <Badge tone="red">acknowledge overdue</Badge> : t.ackHoursLeft != null ? <Badge tone="amber">ack in {t.ackHoursLeft}h</Badge> : null}
                    {t.resolveOverdue ? <Badge tone="red">resolve overdue</Badge> : t.resolveHoursLeft != null ? <Badge tone="neutral">resolve in {Math.round(t.resolveHoursLeft / 24)}d</Badge> : null}
                  </span>
                </button>
                {open === t.id && <TicketDetail id={t.id} onDone={() => { setOpen(null); load(); }} />}
              </Card>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-lg font-bold">Orders by state</h2>
        <div className="grid gap-3 md:grid-cols-3" data-testid="board">
          {board.columns.map((c) => (
            <Card key={c.key} className="p-3" data-testid={`col-${c.key}`}>
              <div className="flex items-center justify-between"><div className="text-sm font-semibold">{c.label}</div><Badge tone={c.orders.length ? 'amber' : 'neutral'}>{c.orders.length}</Badge></div>
              <ul className="mt-2 space-y-1 text-xs text-ink-soft">
                {c.orders.slice(0, 8).map((o) => <li key={o.id} className="flex justify-between"><span>#{o.id} · {o.kitchen}</span><span>{formatINR(o.foodPaise)} · {ago(o.minutesInState)}</span></li>)}
                {c.orders.length === 0 && <li className="text-ink-faint">Nothing here</li>}
              </ul>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}

function TicketDetail({ id, onDone }: { id: number; onDone: () => void }) {
  const toast = useToast();
  const [d, setD] = useState<Detail | null>(null);
  const [note, setNote] = useState('');
  const [kind, setKind] = useState('mark_paid');
  const [target, setTarget] = useState<'buyer' | 'seller'>('buyer');
  const [amount, setAmount] = useState('');
  const [chatReason, setChatReason] = useState('');
  const [chat, setChat] = useState<{ buyer: string; kitchen: string; messages: { id: number; label: string; body: string; imageUrl: string | null }[] } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    fetch(`/api/admin/disputes/${id}`).then((r) => r.json()).then(setD);
  }, [id]);

  async function decide() {
    setBusy(true);
    const outcome = kind === 'issue_credit' ? { kind, amountPaise: Math.round(Number(amount) * 100) } : kind === 'warn' ? { kind, target, message: note } : kind === 'suspend' ? { kind, target } : { kind };
    const res = await fetch(`/api/admin/disputes/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note, outcome }) });
    const out = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return toast(out.error || 'Could not apply that', 'err');
    toast(out.resolved ? 'Decision recorded; ticket resolved' : 'Warning sent');
    onDone();
  }
  async function readChat() {
    if (!d?.order) return;
    const res = await fetch(`/api/admin/chat/${d.order.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: chatReason }) });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) return toast(out.error || 'Could not open the chat', 'err');
    setChat(out);
  }
  if (!d) return <Skeleton className="mt-3 h-32 w-full" />;
  const o = d.order;
  return (
    <div className="mt-3 space-y-3 border-t border-rice-line pt-3 text-sm" data-testid="ticket-detail">
      {d.ticket.body && <p><strong>Statement:</strong> {d.ticket.body}</p>}
      {o && (
        <div className="grid gap-1 rounded-xl bg-rice-deep p-3 text-xs sm:grid-cols-2">
          <div>Order #{o.id} · {o.status.replaceAll('_', ' ')}</div>
          <div>{o.kitchen} → {o.buyer}{o.buyerSociety ? ` (${o.buyerSociety})` : ''}</div>
          <div>Food {formatINR(o.foodPaise)} · fee {formatINR(o.feePaise)}</div>
          <div>{o.items.join(', ')}</div>
          <div data-testid="buyer-claim">Buyer says: {o.buyerClaim.method ? `paid by ${o.buyerClaim.method}` : 'no payment claim'}{o.buyerClaim.utr ? ` · UTR ${o.buyerClaim.utr}` : ''}</div>
          <div data-testid="kitchen-statement">Kitchen says: {o.kitchenStatement ?? '—'}</div>
        </div>
      )}
      <div>
        <div className="eyebrow">TIMELINE</div>
        <ul className="mt-1 space-y-0.5 text-xs text-ink-soft" data-testid="timeline">{d.timeline.map((e, i) => <li key={i}>{new Date(e.at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'short', timeStyle: 'short' })} · {e.status.replaceAll('_', ' ')}{e.note ? ` — ${e.note}` : ''}</li>)}</ul>
      </div>
      {o && d.chatMayRead && (
        <div className="space-y-2">
          <div className="eyebrow">CHAT (OPENING IT IS LOGGED)</div>
          {!chat ? (
            <div className="flex gap-2">
              <Input placeholder="Why are you opening this chat?" value={chatReason} onChange={(e) => setChatReason(e.target.value)} data-testid="chat-reason" />
              <Button size="sm" variant="secondary" disabled={chatReason.trim().length < 5} onClick={readChat} data-testid="open-chat">Open</Button>
            </div>
          ) : (
            <ul className="space-y-1 rounded-xl bg-rice-deep p-3 text-xs" data-testid="admin-chat">{chat.messages.map((m) => <li key={m.id}><strong>{m.label}:</strong> {m.body}</li>)}{chat.messages.length === 0 && <li>No messages</li>}</ul>
          )}
        </div>
      )}
      <div className="space-y-2 rounded-xl border border-rice-line p-3">
        <div className="eyebrow">DECISION</div>
        <Field label="Outcome">
          <Select value={kind} onChange={(e) => setKind(e.target.value)} data-testid="outcome">
            <option value="mark_paid">Mark paid (the buyer did pay)</option>
            <option value="mark_unpaid">Mark unpaid (+ buyer strike)</option>
            <option value="refund_fee">Refund the platform fee</option>
            <option value="issue_credit">Issue credit</option>
            <option value="warn">Warn a party</option>
            <option value="suspend">Suspend a party</option>
          </Select>
        </Field>
        {(kind === 'warn' || kind === 'suspend') && (
          <Field label="Who"><Select value={target} onChange={(e) => setTarget(e.target.value as 'buyer' | 'seller')}><option value="buyer">Buyer</option><option value="seller">Kitchen</option></Select></Field>
        )}
        {kind === 'issue_credit' && <Field label="Credit (₹)"><Input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="credit-amount" /></Field>}
        <Field label={kind === 'warn' ? 'Message to them (also the note)' : 'Note for the record'}><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} data-testid="decision-note" /></Field>
        <Button loading={busy} disabled={note.trim().length < 3 || (kind === 'issue_credit' && !Number(amount))} onClick={decide} data-testid="decide">Apply decision</Button>
      </div>
    </div>
  );
}
