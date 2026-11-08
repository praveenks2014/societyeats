'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge, Button, Card, Input, Skeleton } from '@/components/ui';
import { MockCheckoutSheet } from '@/components/mock-checkout';
import { useToast } from '@/components/providers';
import { formatINR } from '@/lib/money';
import { DisclaimerClient } from '@/components/disclaimer-client';
import { BRAND } from '@/config/brand';

type Upi = { vpa: string; registeredName: string; payeeName: string; uri: string; qrSvg: string; amountInPaise: number };

/**
 * Buyer: pay-at-the-door step. The kitchen's UPI ID, registered name and QR are only in the response once the
 * kitchen has marked "reached your door" / "buyer has arrived", so before that this card shows what to expect.
 */
export function AtDoorPaymentCard({
  orderId,
  status,
  paymentStatus,
  utr,
  foodTotalInPaise,
  kitchenName,
  acceptsCash,
  upi,
  onChanged,
}: {
  orderId: number;
  status: string;
  paymentStatus: string | null;
  utr: string | null;
  foodTotalInPaise: number;
  kitchenName: string;
  acceptsCash: boolean;
  upi: Upi | null;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [utrInput, setUtrInput] = useState('');
  const [method, setMethod] = useState<'upi' | 'cash'>('upi');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const show = ['at_door', 'collected', 'payment_claimed', 'payment_disputed', 'completed'].includes(status);
  if (!show) {
    if (!['booked', 'accepted', 'preparing', 'ready', 'on_the_way'].includes(status)) return null;
    return (
      <Card className="mt-4 p-4" data-testid="pay-later-note">
        <div className="eyebrow">PAYING FOR THE FOOD</div>
        <p className="mt-1.5 text-sm">
          You&apos;ll pay <strong>{formatINR(foodTotalInPaise)}</strong> to <strong>{kitchenName}</strong> at your door, after the food reaches you. Never pay anyone in advance.
        </p>
      </Card>
    );
  }

  async function act(action: 'collect' | 'claim_paid') {
    setBusy(true);
    const res = await fetch(`/api/orders/${orderId}/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(action === 'claim_paid' ? { action, method, utr: utrInput.trim() || undefined } : { action }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return toast(d.error || 'Could not record that', 'err');
    toast(action === 'collect' ? 'Enjoy your food!' : 'Thanks — the kitchen will confirm');
    onChanged();
  }

  const done = status === 'completed';
  return (
    <Card className="mt-4 border-2 border-turmeric/40 p-4" data-testid="upi-step">
      <div className="flex items-center justify-between">
        <div className="eyebrow">PAY {kitchenName.toUpperCase()}</div>
        {done ? <Badge tone="green">Paid</Badge> : status === 'payment_claimed' ? <Badge tone="amber">Waiting for kitchen</Badge> : status === 'payment_disputed' ? <Badge tone="red">Under review</Badge> : null}
      </div>
      <div className="mt-2 text-2xl font-bold" data-testid="door-amount">{formatINR(foodTotalInPaise)}</div>
      {upi && <DisclaimerClient id="qr-check" vars={{ 'registered name': upi.registeredName }} className="mt-2" />}

      {status === 'at_door' && (
        <>
          <p className="mt-2 text-sm text-ink-soft">The food is here. Check it, then tap <strong>I&apos;ve got my food</strong> and pay.</p>
          <Button size="lg" className="mt-3 w-full" loading={busy} onClick={() => act('collect')} data-testid="collect">
            I&apos;ve got my food
          </Button>
        </>
      )}

      {upi && ['collected', 'payment_claimed', 'payment_disputed'].includes(status) && !done && (
        <>
          <p className="mt-2 rounded-xl bg-turmeric-tint px-3 py-2 text-xs text-turmeric-deep" role="note" data-testid="qr-check">
            Before you pay, check that the name in your UPI app is <strong>{upi.registeredName}</strong>. Never pay anyone who asks you to pay before the food reaches you.
          </p>
          {/* mobile: open the UPI app; desktop: scan the QR */}
          <a href={upi.uri} className="mt-3 flex min-h-[48px] items-center justify-center rounded-xl bg-turmeric px-4 text-base font-bold text-ink md:hidden" data-testid="upi-intent">
            Pay with UPI app
          </a>
          <div className="mt-3 hidden flex-col items-center md:flex">
            <div className="rounded-xl border border-rice-line bg-white p-2" dangerouslySetInnerHTML={{ __html: upi.qrSvg }} data-testid="upi-qr" />
            <p className="mt-1 text-xs text-ink-faint">Scan with any UPI app</p>
          </div>
          <div className="mt-3 flex items-center justify-between gap-2 rounded-xl bg-rice px-3 py-2 text-sm">
            <span className="min-w-0 truncate" data-testid="upi-id">UPI ID: <strong>{upi.vpa}</strong> · {upi.registeredName}</span>
            <button
              className="min-h-[44px] shrink-0 px-2 text-xs font-semibold text-leaf underline"
              onClick={() => navigator.clipboard?.writeText(upi.vpa).then(() => setCopied(true)).catch(() => {})}
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </>
      )}

      {status === 'collected' && (
        <div className="mt-3 space-y-2">
          {acceptsCash && (
            <div className="flex gap-2" role="radiogroup" aria-label="How did you pay?">
              {(['upi', 'cash'] as const).map((m) => (
                <button key={m} role="radio" aria-checked={method === m} onClick={() => setMethod(m)} className={`min-h-[44px] flex-1 rounded-xl border-2 text-sm font-semibold ${method === m ? 'border-leaf bg-leaf-tint text-leaf' : 'border-rice-line'}`}>
                  {m === 'upi' ? 'UPI' : 'Cash'}
                </button>
              ))}
            </div>
          )}
          {method === 'upi' && <Input value={utrInput} onChange={(e) => setUtrInput(e.target.value.replace(/\D/g, '').slice(0, 12))} inputMode="numeric" placeholder="12-digit UPI reference / UTR (optional)" aria-label="UPI reference number" />}
          <Button size="lg" className="w-full" loading={busy} onClick={() => act('claim_paid')} data-testid="claim-paid">
            I&apos;ve paid {formatINR(foodTotalInPaise)}
          </Button>
        </div>
      )}
      {status === 'payment_claimed' && (
        <p className="mt-3 text-sm text-ink-soft" role="status">
          You said you paid{utr ? ` (UTR ${utr})` : ''}. {kitchenName} will confirm shortly.
        </p>
      )}
      {status === 'payment_disputed' && (
        <p className="mt-3 text-sm text-chili-dark" role="alert">
          The kitchen couldn’t find your payment. {BRAND.name} is looking into it — keep your UPI receipt handy.
        </p>
      )}
      {done && <p className="mt-3 text-sm font-semibold text-leaf">✅ {kitchenName} confirmed your payment.</p>}
      {paymentStatus === 'auto_confirmed' && <p className="mt-1 text-xs text-ink-faint">Completed automatically.</p>}
    </Card>
  );
}

/** Buyer: the platform fee wasn't paid yet — pay again before the order expires. */
export function FeeRetryCard({ orderId, amountInPaise, expiresAt, mockMode, onPaid }: { orderId: number; amountInPaise: number; expiresAt: string | null; mockMode: boolean; onPaid: () => void }) {
  const toast = useToast();
  const [sheet, setSheet] = useState(false);
  const [left, setLeft] = useState('');

  useEffect(() => {
    if (!expiresAt) return;
    const tick = () => {
      const ms = new Date(expiresAt).getTime() - Date.now();
      setLeft(ms <= 0 ? 'expired' : `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`);
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [expiresAt]);

  async function onResult(outcome: 'success' | 'failure') {
    const res = await fetch('/api/payments/mock-complete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId, outcome }) });
    setSheet(false);
    if (outcome === 'success' && res.ok) {
      toast('Platform fee paid 🎉');
      onPaid();
    } else toast('Payment failed (simulated) — you can try again', 'err');
  }

  return (
    <Card className="mt-4 border-2 border-turmeric/40 p-4">
      <div className="eyebrow">STEP 1 · PAY THE PLATFORM FEE</div>
      <p className="mt-1.5 text-sm">
        Pay <strong>{formatINR(amountInPaise)}</strong> to send this order to the kitchen. {left && left !== 'expired' ? <>Held for <strong>{left}</strong>.</> : null}
      </p>
      {mockMode ? (
        <Button className="mt-3 w-full" size="lg" onClick={() => setSheet(true)}>
          Pay {formatINR(amountInPaise)} (test mode)
        </Button>
      ) : (
        <p className="mt-2 text-xs text-ink-faint">Go back to checkout to pay again.</p>
      )}
      <MockCheckoutSheet open={sheet} orderId={orderId} amountInPaise={amountInPaise} onResult={onResult} onClose={() => setSheet(false)} />
    </Card>
  );
}

type ChatMsg = { id: number; from: string; label: string; mine: boolean; body: string; imageUrl: string | null; flags: string[]; reported: boolean; at: string; pending?: boolean };
type Thread = {
  state: { open: boolean; reason?: string };
  viewer: 'buyer' | 'seller' | 'admin';
  buyerHandle: string;
  kitchenLabel: string;
  otherLabel: string;
  quickReplies: { key: string; text: string }[];
  maxLength: number;
  imagesEnabled: boolean;
  preDoor: boolean;
  phone: { mine: boolean; theirs: string | null };
  etag: string;
  messages: ChatMsg[];
};
type Warning = { kind: string; message: string };

/**
 * Order chat. Live over server-sent events; if the stream drops twice quickly (some hosts cut long connections) it falls
 * back to polling every 5 s with an ETag, so an unchanged thread costs a 304. Messages appear instantly (optimistic) and are
 * confirmed by their server id. Used by the buyer on the order page and by the kitchen on /seller/orders.
 */
export function OrderThread({ orderId, onRefund }: { orderId: number; onRefund?: () => void }) {
  const toast = useToast();
  const [t, setT] = useState<Thread | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [warn, setWarn] = useState<{ warnings: Warning[]; payload: Record<string, unknown> } | null>(null);
  const [mode, setMode] = useState<'sse' | 'poll'>('sse');
  const [uploading, setUploading] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const etag = useRef('');
  const lastId = useRef(0);
  const fileRef = useRef<HTMLInputElement>(null);

  const merge = useCallback((incoming: ChatMsg[]) => {
    setT((cur) => {
      if (!cur) return cur;
      const have = new Set(cur.messages.map((m) => m.id));
      const fresh = incoming.filter((m) => !have.has(m.id));
      if (!fresh.length) return cur;
      // drop an optimistic copy of my own message once the confirmed one arrives
      const pendingMine = cur.messages.filter((m) => m.pending);
      const keepPending = pendingMine.filter((p) => !fresh.some((f) => f.mine && f.body === p.body));
      const confirmed = cur.messages.filter((m) => !m.pending);
      lastId.current = Math.max(lastId.current, ...fresh.map((m) => m.id));
      return { ...cur, messages: [...confirmed, ...fresh, ...keepPending] };
    });
  }, []);

  const load = useCallback(async (markRead = false) => {
    const res = await fetch(`/api/orders/${orderId}/messages${markRead ? '?markRead=1' : ''}`, { headers: !markRead && etag.current ? { 'If-None-Match': etag.current } : undefined });
    if (res.status === 304) return;
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return setErr(d.error || 'Messages unavailable');
    etag.current = d.etag;
    lastId.current = d.messages.length ? d.messages[d.messages.length - 1].id : 0;
    setT((cur) => (cur ? { ...d, messages: [...d.messages, ...cur.messages.filter((m) => m.pending)] } : d));
  }, [orderId]);

  useEffect(() => {
    load(true);
  }, [load]);

  // live updates: SSE, then polling if it keeps failing
  useEffect(() => {
    if (!t?.state.open || t.viewer === 'admin') return;
    if (mode === 'poll') {
      const i = setInterval(() => load(false), 5000);
      return () => clearInterval(i);
    }
    if (typeof EventSource === 'undefined') {
      setMode('poll');
      return;
    }
    let failures = 0;
    let firstFail = 0;
    const es = new EventSource(`/api/orders/${orderId}/chat/stream?after=${lastId.current}`);
    es.addEventListener('message', (e) => {
      failures = 0;
      try {
        merge([JSON.parse((e as MessageEvent).data)]);
      } catch {
        /* ignore a malformed frame */
      }
    });
    es.onerror = () => {
      const now = Date.now();
      if (!firstFail || now - firstFail > 15_000) {
        firstFail = now;
        failures = 0;
      }
      failures++;
      if (failures >= 2) {
        es.close();
        setMode('poll');
      }
    };
    return () => es.close();
  }, [orderId, t?.state.open, t?.viewer, mode, load, merge]);

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' });
  }, [t?.messages.length]);

  // keep the unread count honest while the chat is on screen
  const msgCount = t?.messages.filter((m) => !m.pending).length ?? 0;
  useEffect(() => {
    if (msgCount && t?.viewer !== 'admin') fetch(`/api/orders/${orderId}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'mark_read' }) }).catch(() => {});
  }, [msgCount, orderId, t?.viewer]);

  async function act(payload: Record<string, unknown>) {
    const res = await fetch(`/api/orders/${orderId}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const d = await res.json().catch(() => ({}));
    return { ok: res.ok, d };
  }

  async function send(payload: Record<string, unknown>, optimisticText: string) {
    const tempId = -Date.now();
    setBusy(true);
    setT((cur) => (cur && optimisticText ? { ...cur, messages: [...cur.messages, { id: tempId, from: cur.viewer, label: '', mine: true, body: optimisticText, imageUrl: null, flags: [], reported: false, at: new Date().toISOString(), pending: true }] } : cur));
    const { ok, d } = await act({ action: 'send', ...payload });
    setBusy(false);
    setT((cur) => (cur ? { ...cur, messages: cur.messages.filter((m) => m.id !== tempId) } : cur));
    if (!ok) return toast(d.error || 'Could not send', 'err');
    if (d.sent === false && d.warnings) {
      setWarn({ warnings: d.warnings, payload });
      return;
    }
    setBody('');
    setWarn(null);
    etag.current = d.etag;
    setT((cur) => (cur ? { ...d, messages: d.messages } : d));
    lastId.current = d.messages.length ? d.messages[d.messages.length - 1].id : lastId.current;
  }

  async function sendImage(file: File) {
    setUploading(true);
    const fd = new FormData();
    fd.append('file', file);
    fd.append('purpose', 'chat_image');
    const up = await fetch('/api/uploads', { method: 'POST', body: fd });
    const u = await up.json().catch(() => ({}));
    setUploading(false);
    if (!up.ok) return toast(u.error || 'Upload failed', 'err');
    await send({ imageKey: u.key, body }, '');
  }

  async function simple(payload: Record<string, unknown>, okMsg?: string) {
    const { ok, d } = await act(payload);
    if (!ok) return toast(d.error || 'Could not do that', 'err');
    if (okMsg) toast(okMsg);
    etag.current = d.etag;
    setT((cur) => (cur ? { ...d, messages: [...d.messages, ...cur.messages.filter((m) => m.pending)] } : d));
  }

  if (err) return null;
  if (!t) return <Skeleton className="mt-4 h-32 w-full" />;
  const canWrite = t.state.open && t.viewer !== 'admin';

  return (
    <Card className="mt-4 p-4" id="messages" data-testid="chat" data-mode={mode}>
      <div className="flex items-center justify-between gap-2">
        <div className="eyebrow">MESSAGES · {t.otherLabel}</div>
        {t.viewer !== 'admin' && (
          <div className="flex items-center gap-2 text-[11px] text-ink-faint">
            <button className="min-h-[44px] px-1 underline" onClick={() => confirm(`Report this person to ${BRAND.name}?`) && simple({ action: 'report_user', reason: 'Reported from chat' }, 'Reported. We will look into it.')} data-testid="chat-report-user">Report</button>
            <button className="min-h-[44px] px-1 underline" onClick={() => confirm('Block this person from messaging you and from ordering with you?') && simple({ action: 'block' }, 'Blocked')} data-testid="chat-block">Block</button>
          </div>
        )}
      </div>
      <DisclaimerClient id="chat" className="mt-2" />
      {t.viewer !== 'admin' && (
        <label className="mt-2 flex min-h-[44px] items-center gap-3 text-xs text-ink-soft">
          <input type="checkbox" className="h-5 w-5 accent-leaf" checked={t.phone.mine} onChange={(e) => simple({ action: 'share_phone', on: e.target.checked })} data-testid="share-phone" />
          Share my phone number with {t.viewer === 'buyer' ? 'the kitchen' : 'the buyer'} for this order
        </label>
      )}
      {t.phone.theirs && <p className="rounded-xl bg-leaf-tint px-3 py-2 text-xs text-leaf" data-testid="their-phone">{t.otherLabel} shared their number: <strong>{t.phone.theirs}</strong></p>}
      <div className="mt-2 max-h-72 space-y-2 overflow-y-auto" aria-live="polite">
        {t.messages.length === 0 && <p className="py-3 text-center text-xs text-ink-faint">No messages yet. Your surname, flat and phone number stay private.</p>}
        {t.messages.map((m) => (
          <div key={m.id} className={`flex flex-col ${m.mine ? 'items-end' : 'items-start'}`} data-testid="chat-msg">
            <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${m.mine ? 'bg-leaf text-white' : 'bg-rice-deep'} ${m.pending ? 'opacity-60' : ''}`}>
              {m.label && <div className={`text-[10px] font-semibold ${m.mine ? 'text-white/70' : 'text-ink-faint'}`}>{m.label}</div>}
              {m.imageUrl && (
                <img src={m.imageUrl} alt="Photo sent in chat" className="mb-1 max-h-48 rounded-xl" />
              )}
              {m.body}
              {!m.mine && t.viewer !== 'admin' && !m.reported && !m.pending && (
                <button className="ml-2 min-h-[28px] text-[10px] underline opacity-60" onClick={() => simple({ action: 'report', messageId: m.id }, 'Message reported')} data-testid="chat-report-msg">report</button>
              )}
              {m.reported && <span className="ml-2 text-[10px] opacity-60">reported</span>}
            </div>
            {!m.mine && t.preDoor && m.flags.includes('payment_request') && <DisclaimerClient id="pay-at-door" className="mt-1 max-w-[85%]" />}
          </div>
        ))}
        <div ref={end} />
      </div>
      {warn && (
        <div className="mt-2 rounded-xl bg-turmeric-tint px-3 py-2 text-xs text-turmeric-deep" role="alert" data-testid="chat-warning">
          <ul className="list-disc pl-4">{warn.warnings.map((w) => <li key={w.kind}>{w.message}</li>)}</ul>
          <div className="mt-2 flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => setWarn(null)} data-testid="chat-edit">Edit message</Button>
            <Button size="sm" onClick={() => send({ ...warn.payload, confirmed: true }, String(warn.payload.body ?? ''))} data-testid="chat-send-anyway">Send anyway</Button>
          </div>
        </div>
      )}
      {canWrite ? (
        <>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {t.quickReplies.map((q) => (
              <button
                key={q.key}
                disabled={busy}
                data-testid={`quick-${q.key}`}
                onClick={() => (q.key === 'refund' && onRefund ? (setBody(q.text), onRefund()) : send({ quickReplyKey: q.key }, q.text))}
                className="min-h-[36px] rounded-pill border border-rice-line bg-white px-3 text-xs font-medium text-ink-soft hover:border-leaf/40"
              >
                {q.text}
              </button>
            ))}
          </div>
          <form
            className="mt-2 flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (body.trim()) send({ body }, body.trim());
            }}
          >
            {t.imagesEnabled && (
              <>
                <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => e.target.files?.[0] && sendImage(e.target.files[0])} data-testid="chat-image-input" />
                <Button type="button" variant="secondary" size="sm" loading={uploading} onClick={() => fileRef.current?.click()} aria-label="Send a photo">📷</Button>
              </>
            )}
            <Input value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write a message" maxLength={t.maxLength} aria-label="Message" data-testid="chat-input" />
            <Button type="submit" loading={busy} disabled={!body.trim()} data-testid="chat-send">
              Send
            </Button>
          </form>
        </>
      ) : (
        <p className="mt-2 text-xs text-ink-faint">{t.state.reason ?? (t.viewer === 'admin' ? 'Read-only (dispute review).' : 'Conversation closed.')}</p>
      )}
    </Card>
  );
}
