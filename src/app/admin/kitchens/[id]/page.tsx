'use client';

import Link from 'next/link';
import { use, useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, Field, Input, Modal, Select, Skeleton, Textarea, VegDot } from '@/components/ui';
import { FoodImage } from '@/components/food-image';
import { useToast } from '@/components/providers';
import { formatINR } from '@/lib/money';

type Detail = {
  kitchen: {
    userId: number;
    kitchenName: string;
    bio: string | null;
    listingState: string;
    listingReviewNote: string | null;
    delistReasonCategory: string | null;
    tower: string | null;
    upiVpa: string | null;
    upiName: string | null;
    acceptsUpiNow: boolean;
    acceptsPayAtPickup: boolean;
    kitchenPhotosJson: string[] | null;
    kitchenVideoUrl: string | null;
    fssaiStatus: string;
    fssaiNumber: string | null;
    fssaiExpiry: string | null;
    fssaiCertificateUrl: string | null;
    owner: { id: number; name: string; phone: string; email: string | null; emailVerified: boolean; blocked: boolean };
    society: { id: number; name: string } | null;
  };
  applications: { id: number; status: string; foscosRefNumber: string | null; documentsJson: { label: string; url: string }[] | null; createdAt: string }[];
  dishes: { id: number; title: string; priceInPaise: number; isVeg: boolean; photoUrl: string | null; moderationStatus: string; moderationNote: string | null; isActive: boolean }[];
  subscriptions: { id: number; planNameSnapshot: string | null; status: string; effectiveStatus: string; startsAt: string | null; endsAt: string | null; totalPaise: number; notes: string | null; paidAt: string | null }[];
  subscriptionDaysLeft: number | null;
  gate: { ok: boolean; checks: Record<string, boolean>; reasons: string[] };
  isFeatured: boolean;
};
type Template = { id: number; title: string; body: string };

const CATEGORIES = [
  ['hygiene', 'Hygiene'], ['complaints', 'Repeated complaints'], ['fssai', 'FSSAI / licence'], ['misleading_listing', 'Misleading listing'],
  ['non_payment', 'Non-payment / refunds owed'], ['owner_request', 'Owner request'], ['other', 'Other'],
] as const;
const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '—');
type Dialog = null | { kind: 'request_changes' | 'reject' } | { kind: 'delist' } | { kind: 'message' } | { kind: 'grant' } | { kind: 'hide'; dishId: number; title: string } | { kind: 'extend'; subId: number } | { kind: 'cancel'; subId: number } | { kind: 'refund'; subId: number };

export default function KitchenDetail({ params }: { params: Promise<{ id: string }> }) {
  const id = Number(use(params).id);
  const toast = useToast();
  const [d, setD] = useState<Detail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const [category, setCategory] = useState('hygiene');
  const [subject, setSubject] = useState('');
  const [months, setMonths] = useState('1');
  const [days, setDays] = useState('7');
  const [templates, setTemplates] = useState<Template[]>([]);

  const load = useCallback(() => {
    fetch(`/api/admin/kitchens/${id}`).then(async (r) => {
      const j = await r.json();
      if (!r.ok) setErr(j.error || 'Could not load');
      else setD(j);
    });
  }, [id]);
  useEffect(load, [load]);
  useEffect(() => {
    fetch('/api/admin/inbox/templates').then((r) => r.json()).then((j) => setTemplates(j.templates ?? [])).catch(() => {});
  }, []);

  async function post(url: string, body: Record<string, unknown>, ok: string) {
    setBusy(true);
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return toast(j.error || 'Failed', 'err');
    toast(ok);
    setDialog(null);
    setReason('');
    setSubject('');
    load();
  }
  const act = (body: Record<string, unknown>, ok: string) => post(`/api/admin/kitchens/${id}`, body, ok);
  const sub = (body: Record<string, unknown>, ok: string) => post('/api/admin/subscriptions', body, ok);

  if (err) return <p className="pt-10 text-center text-sm text-chili">{err}</p>;
  if (!d) return <Skeleton className="h-96 w-full" />;
  const k = d.kitchen;
  const photos = k.kitchenPhotosJson ?? [];

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Link href="/admin/kitchens/requests" className="text-sm font-semibold text-leaf underline">← Requests</Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{k.kitchenName}</h1>
          <p className="text-sm text-ink-soft">{k.owner.name} · {k.owner.phone} · {k.owner.email ?? 'no email'} {k.owner.emailVerified ? '✓' : '(unverified)'}</p>
          <p className="text-xs text-ink-faint">{k.society?.name ?? 'No society'}{k.tower ? ` · ${k.tower}` : ''}</p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <Badge tone={k.listingState === 'approved' ? 'green' : k.listingState === 'delisted' || k.listingState === 'rejected' ? 'red' : 'amber'}>{k.listingState.replace('_', ' ')}</Badge>
          <Badge tone={d.gate.ok ? 'green' : 'neutral'}>{d.gate.ok ? 'Live to buyers' : 'Not live'}</Badge>
        </div>
      </div>

      {/* actions */}
      <Card className="flex flex-wrap gap-2 p-3" data-testid="kitchen-actions">
        {k.listingState === 'submitted' && (
          <>
            <Button loading={busy} onClick={() => act({ action: 'approve' }, 'Kitchen approved ✅')} data-testid="approve">Approve</Button>
            <Button variant="secondary" onClick={() => setDialog({ kind: 'request_changes' })} data-testid="request-changes">Request changes</Button>
            <Button variant="danger" onClick={() => setDialog({ kind: 'reject' })}>Reject</Button>
          </>
        )}
        {k.listingState === 'approved' && <Button variant="danger" onClick={() => setDialog({ kind: 'delist' })} data-testid="delist">Delist kitchen</Button>}
        {k.listingState === 'delisted' && <Button loading={busy} onClick={() => act({ action: 'relist' }, 'Kitchen relisted ✅')} data-testid="relist">Relist</Button>}
        <Button variant="secondary" onClick={() => setDialog({ kind: 'message' })} data-testid="message-kitchen">✉️ Message kitchen</Button>
        <Button variant="ghost" onClick={() => act({ action: d.isFeatured ? 'unfeature' : 'feature' }, d.isFeatured ? 'Unfeatured' : 'Featured ⭐')}>{d.isFeatured ? 'Unfeature' : '⭐ Feature'}</Button>
      </Card>
      {k.listingReviewNote && <p className="rounded-xl bg-turmeric-tint px-3 py-2 text-sm"><strong>Last note:</strong> {k.listingReviewNote}</p>}

      {/* go-live checks */}
      <Card className="p-4">
        <div className="eyebrow">GO-LIVE REQUIREMENTS</div>
        <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
          {[['approved', 'Admin approved'], ['subscribed', 'Subscription active / grace'], ['fssai', 'FSSAI gate passes'], ['paymentDetails', 'UPI ID or pay-at-pickup only'], ['notBlocked', 'Account not blocked']].map(([key, label]) => (
            <li key={key} className="flex items-center gap-2"><span aria-hidden>{d.gate.checks[key] ? '✅' : '⬜'}</span>{label}</li>
          ))}
        </ul>
      </Card>

      {/* profile + photos */}
      <Card className="p-4">
        <div className="eyebrow">PROFILE &amp; PHOTOS</div>
        {k.bio && <p className="mt-2 text-sm text-ink-soft">{k.bio}</p>}
        <div className="mt-3 grid grid-cols-3 gap-2" data-testid="kitchen-photos">
          {photos.length === 0 ? <p className="col-span-3 text-sm text-chili">No photos uploaded.</p> : photos.map((u) => <a key={u} href={u} target="_blank" rel="noreferrer"><FoodImage src={u} alt="Kitchen" className="aspect-square w-full rounded-xl" /></a>)}
        </div>
        {k.kitchenVideoUrl && <a href={k.kitchenVideoUrl} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm text-leaf underline">▶ Kitchen video</a>}
      </Card>

      {/* payment details + FSSAI */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="p-4">
          <div className="eyebrow">PAYMENT DETAILS</div>
          <dl className="mt-2 space-y-1 text-sm">
            <div className="flex justify-between"><dt className="text-ink-soft">UPI ID</dt><dd className="font-mono text-xs">{k.upiVpa ?? '—'}</dd></div>
            <div className="flex justify-between"><dt className="text-ink-soft">Name</dt><dd>{k.upiName ?? '—'}</dd></div>
            <div className="flex justify-between"><dt className="text-ink-soft">UPI now</dt><dd>{k.acceptsUpiNow ? 'Yes' : 'No'}</dd></div>
            <div className="flex justify-between"><dt className="text-ink-soft">Pay at pickup</dt><dd>{k.acceptsPayAtPickup ? 'Yes' : 'No'}</dd></div>
          </dl>
        </Card>
        <Card className="p-4">
          <div className="eyebrow">FSSAI</div>
          <dl className="mt-2 space-y-1 text-sm">
            <div className="flex justify-between"><dt className="text-ink-soft">Status</dt><dd>{k.fssaiStatus.replaceAll('_', ' ')}</dd></div>
            <div className="flex justify-between"><dt className="text-ink-soft">Number</dt><dd className="font-mono text-xs">{k.fssaiNumber ?? '—'}</dd></div>
            <div className="flex justify-between"><dt className="text-ink-soft">Expiry</dt><dd>{k.fssaiExpiry ?? '—'}</dd></div>
          </dl>
          <div className="mt-2 space-y-1 text-sm">
            {k.fssaiCertificateUrl && <a href={k.fssaiCertificateUrl} target="_blank" rel="noreferrer" className="block text-leaf underline">📄 Certificate (view is audit-logged)</a>}
            {d.applications.map((a) => (
              <div key={a.id}>
                <span className="text-xs text-ink-faint">Application #{a.id} · {a.status.replaceAll('_', ' ')}{a.foscosRefNumber ? ` · ref ${a.foscosRefNumber}` : ''}</span>
                {a.documentsJson?.map((doc) => <a key={doc.url} href={doc.url} target="_blank" rel="noreferrer" className="block text-leaf underline">📎 {doc.label}</a>)}
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* dishes */}
      <Card className="p-4">
        <div className="eyebrow">DISHES ({d.dishes.length})</div>
        <div className="mt-2 space-y-2">
          {d.dishes.map((x) => (
            <div key={x.id} className="flex items-center gap-3">
              <FoodImage src={x.photoUrl} alt="" className="h-12 w-12 shrink-0 rounded-lg" />
              <div className="min-w-0 flex-1 text-sm">
                <div className="flex items-center gap-1.5"><VegDot isVeg={x.isVeg} /><span className="truncate font-semibold">{x.title}</span></div>
                <div className="text-xs text-ink-faint">{formatINR(x.priceInPaise)} · {x.moderationStatus}{x.moderationNote ? ` — ${x.moderationNote}` : ''}</div>
              </div>
              {x.moderationStatus === 'hidden' ? (
                <Button size="sm" variant="secondary" onClick={() => act({ action: 'unhide_dish', dishId: x.id }, 'Dish visible again')}>Unhide</Button>
              ) : (
                <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: 'hide', dishId: x.id, title: x.title })}>Hide</Button>
              )}
            </div>
          ))}
          <Link href="/admin/dishes/review" className="text-xs font-semibold text-leaf underline">Open dish review queue →</Link>
        </div>
      </Card>

      {/* subscription */}
      <Card className="p-4" data-testid="kitchen-subscriptions">
        <div className="flex items-center justify-between">
          <div className="eyebrow">SUBSCRIPTION {d.subscriptionDaysLeft != null ? `· ${d.subscriptionDaysLeft}d left` : ''}</div>
          <Button size="sm" variant="secondary" onClick={() => setDialog({ kind: 'grant' })} data-testid="grant-free">Grant free period</Button>
        </div>
        <div className="mt-2 space-y-2">
          {d.subscriptions.length === 0 && <p className="text-sm text-ink-faint">No subscription yet.</p>}
          {d.subscriptions.map((s) => (
            <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-rice px-3 py-2 text-sm">
              <div>
                <div className="font-semibold">{s.planNameSnapshot ?? 'Subscription'} <Badge tone={['active', 'waived'].includes(s.effectiveStatus) ? 'green' : s.effectiveStatus === 'grace' ? 'amber' : 'neutral'}>{s.effectiveStatus.replace('_', ' ')}</Badge></div>
                <div className="text-xs text-ink-faint">{fmt(s.startsAt)} → {fmt(s.endsAt)}{s.totalPaise ? ` · ${formatINR(s.totalPaise)}` : ''}{s.notes ? ` · ${s.notes}` : ''}</div>
              </div>
              {s.status !== 'cancelled' && s.status !== 'pending_payment' && (
                <div className="flex gap-1.5">
                  <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: 'extend', subId: s.id })}>Extend</Button>
                  {s.paidAt && <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: 'refund', subId: s.id })}>Refund</Button>}
                  <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: 'cancel', subId: s.id })}>Cancel</Button>
                </div>
              )}
            </div>
          ))}
        </div>
      </Card>

      {/* dialogs */}
      <Modal open={!!dialog} onClose={() => !busy && setDialog(null)} sheet>
        {dialog && (
          <div className="space-y-4">
            <h2 className="font-display text-lg font-bold">
              {{ request_changes: 'Request changes', reject: 'Reject listing request', delist: 'Delist kitchen', message: 'Message kitchen', grant: 'Grant a free period', hide: 'Hide dish', extend: 'Extend period', cancel: 'Cancel period', refund: 'Refund subscription' }[dialog.kind]}
              {dialog.kind === 'hide' ? `: ${dialog.title}` : ''}
            </h2>
            {dialog.kind === 'delist' && <p className="text-sm text-ink-soft">All dishes are hidden and new orders blocked. Open orders can still be completed. The kitchen is notified in-app and by email. The subscription is not touched.</p>}
            {(dialog.kind === 'delist' || dialog.kind === 'hide') && (
              <Field label="Reason category">
                <Select value={category} onChange={(e) => setCategory(e.target.value)}>
                  {CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </Select>
              </Field>
            )}
            {dialog.kind === 'message' && (
              <>
                <Field label="Template">
                  <Select defaultValue="" onChange={(e) => { const t = templates.find((x) => String(x.id) === e.target.value); if (t) { setSubject(t.title); setReason(t.body); } }}>
                    <option value="">— none —</option>
                    {templates.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
                  </Select>
                </Field>
                <Field label="Subject"><Input value={subject} onChange={(e) => setSubject(e.target.value)} data-testid="msg-subject" /></Field>
              </>
            )}
            {dialog.kind === 'grant' && <Field label="Months (1–12)"><Input inputMode="numeric" value={months} onChange={(e) => setMonths(e.target.value)} data-testid="grant-months" /></Field>}
            {dialog.kind === 'extend' && <Field label="Extra days"><Input inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} /></Field>}
            <Field label={dialog.kind === 'message' ? 'Message' : dialog.kind === 'grant' ? 'Reason (e.g. founding kitchen)' : 'Reason / note (required)'}>
              <Textarea rows={4} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="dialog-text" />
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setDialog(null)}>Cancel</Button>
              <Button
                loading={busy}
                disabled={!reason.trim()}
                data-testid="dialog-confirm"
                onClick={() => {
                  if (dialog.kind === 'request_changes') act({ action: 'request_changes', reason }, 'Changes requested');
                  else if (dialog.kind === 'reject') act({ action: 'reject', reason }, 'Rejected');
                  else if (dialog.kind === 'delist') act({ action: 'delist', category, reason }, 'Kitchen delisted');
                  else if (dialog.kind === 'message') act({ action: 'message', subject, body: reason }, 'Message sent ✉️');
                  else if (dialog.kind === 'hide') act({ action: 'hide_dish', dishId: dialog.dishId, category, reason }, 'Dish hidden');
                  else if (dialog.kind === 'grant') sub({ action: 'grant', sellerId: id, months: Number(months), reason }, 'Free period granted 🎁');
                  else if (dialog.kind === 'extend') sub({ action: 'extend', subscriptionId: dialog.subId, days: Number(days), reason }, 'Extended');
                  else if (dialog.kind === 'cancel') sub({ action: 'cancel', subscriptionId: dialog.subId, reason }, 'Cancelled');
                  else if (dialog.kind === 'refund') sub({ action: 'refund', subscriptionId: dialog.subId, reason }, 'Refund issued');
                }}
              >
                Confirm
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
