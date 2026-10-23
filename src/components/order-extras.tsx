'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge, Button, Card, Input, Skeleton } from '@/components/ui';
import { MockCheckoutSheet } from '@/components/mock-checkout';
import { useToast } from '@/components/providers';
import { formatINR } from '@/lib/money';

type Upi = { vpa: string; payeeName: string; uri: string; qrSvg: string; amountInPaise: number };

/** Buyer: the food-payment step shown right after the platform fee is paid. */
export function FoodPaymentCard({
  orderId,
  status,
  mode,
  paymentStatus,
  utr,
  foodTotalInPaise,
  kitchenName,
  upi,
  onChanged,
}: {
  orderId: number;
  status: string;
  mode: string | null;
  paymentStatus: string | null;
  utr: string | null;
  foodTotalInPaise: number;
  kitchenName: string;
  upi: Upi | null;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [utrInput, setUtrInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!mode || ['placed', 'expired', 'cancelled'].includes(status)) return null;

  async function claim() {
    setBusy(true);
    const res = await fetch(`/api/orders/${orderId}/food-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'claim', utr: utrInput.trim() || undefined }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return toast(d.error || 'Could not record that', 'err');
    toast('Thanks — the kitchen will confirm');
    onChanged();
  }

  if (mode === 'pay_at_pickup') {
    return (
      <Card className="mt-4 border-2 border-turmeric/40 p-4" data-testid="pay-at-pickup-note">
        <div className="eyebrow">PAY THE KITCHEN AT PICKUP</div>
        <p className="mt-1.5 text-sm">
          Pay <strong>{formatINR(foodTotalInPaise)}</strong> to <strong>{kitchenName}</strong> by UPI or cash when you collect your food. Show your OTP at handover.
        </p>
        {paymentStatus === 'at_handover' && <p className="mt-2 text-sm font-semibold text-leaf">✅ Kitchen recorded: paid at handover</p>}
      </Card>
    );
  }

  const done = paymentStatus === 'confirmed';
  return (
    <Card className="mt-4 border-2 border-turmeric/40 p-4" data-testid="upi-step">
      <div className="flex items-center justify-between">
        <div className="eyebrow">STEP 2 · PAY {kitchenName.toUpperCase()} BY UPI</div>
        {done ? <Badge tone="green">Confirmed</Badge> : paymentStatus === 'buyer_claimed' ? <Badge tone="amber">Waiting for kitchen</Badge> : paymentStatus === 'not_received' ? <Badge tone="red">Not found</Badge> : null}
      </div>
      <div className="mt-2 text-2xl font-bold">{formatINR(foodTotalInPaise)}</div>

      {upi && !done && (
        <>
          {/* mobile: open the UPI app; desktop: scan the QR */}
          <a href={upi.uri} className="mt-3 flex min-h-[48px] items-center justify-center rounded-xl bg-turmeric px-4 text-base font-bold text-ink md:hidden" data-testid="upi-intent">
            Pay with UPI app
          </a>
          <div className="mt-3 hidden flex-col items-center md:flex">
            <div className="rounded-xl border border-rice-line bg-white p-2" dangerouslySetInnerHTML={{ __html: upi.qrSvg }} data-testid="upi-qr" />
            <p className="mt-1 text-xs text-ink-faint">Scan with any UPI app</p>
          </div>
          <div className="mt-3 flex items-center justify-between gap-2 rounded-xl bg-rice px-3 py-2 text-sm">
            <span className="min-w-0 truncate">UPI ID: <strong>{upi.vpa}</strong> · {upi.payeeName}</span>
            <button
              className="min-h-[44px] shrink-0 px-2 text-xs font-semibold text-leaf underline"
              onClick={() => navigator.clipboard?.writeText(upi.vpa).then(() => setCopied(true)).catch(() => {})}
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </>
      )}

      {paymentStatus === 'pending' && (
        <div className="mt-3 space-y-2">
          <Input value={utrInput} onChange={(e) => setUtrInput(e.target.value)} placeholder="UPI reference / UTR (optional)" aria-label="UPI reference number" />
          <Button size="lg" className="w-full" loading={busy} onClick={claim} data-testid="claim-paid">
            I&apos;ve paid
          </Button>
        </div>
      )}
      {paymentStatus === 'buyer_claimed' && (
        <p className="mt-3 text-sm text-ink-soft" role="status">
          You said you paid{utr ? ` (UTR ${utr})` : ''}. {kitchenName} will confirm shortly — your order isn’t cancelled.
        </p>
      )}
      {paymentStatus === 'not_received' && (
        <p className="mt-3 text-sm text-chili-dark" role="alert">
          The kitchen couldn’t find your payment. PadosiPlate has been alerted — keep your UPI receipt handy.
        </p>
      )}
      {done && <p className="mt-3 text-sm font-semibold text-leaf">✅ {kitchenName} confirmed your payment.</p>}
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

type Thread = {
  state: { open: boolean; reason?: string };
  viewer: 'buyer' | 'seller' | 'admin';
  buyerHandle: string;
  kitchenLabel: string;
  quickReplies: { key: string; text: string }[];
  messages: { id: number; from: string; label: string; mine: boolean; body: string; reported: boolean; at: string }[];
};

/** Anonymous per-order chat (handles only). Used by the buyer on the order page and by the kitchen on /seller/orders. */
export function OrderThread({ orderId, onRefund }: { orderId: number; onRefund?: () => void }) {
  const toast = useToast();
  const [t, setT] = useState<Thread | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/orders/${orderId}/messages`);
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return setErr(d.error || 'Messages unavailable');
    setT(d);
  }, [orderId]);
  useEffect(() => {
    load();
    const i = setInterval(load, 8000);
    return () => clearInterval(i);
  }, [load]);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' });
  }, [t?.messages.length]);

  async function act(payload: Record<string, unknown>) {
    setBusy(true);
    const res = await fetch(`/api/orders/${orderId}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return toast(d.error || 'Could not send', 'err');
    setT(d);
    if (payload.action === 'send') setBody('');
  }

  if (err) return null;
  if (!t) return <Skeleton className="mt-4 h-32 w-full" />;
  const canWrite = t.state.open && t.viewer !== 'admin';

  return (
    <Card className="mt-4 p-4" id="messages">
      <div className="flex items-center justify-between">
        <div className="eyebrow">MESSAGES · {t.viewer === 'buyer' ? t.kitchenLabel : t.buyerHandle}</div>
        {t.viewer !== 'admin' && (
          <button className="min-h-[44px] px-1 text-[11px] text-ink-faint underline" onClick={() => confirm('Block this person from messaging you?') && act({ action: 'block' })}>
            Block
          </button>
        )}
      </div>
      <div className="mt-2 max-h-64 space-y-2 overflow-y-auto" aria-live="polite">
        {t.messages.length === 0 && <p className="py-3 text-center text-xs text-ink-faint">No messages yet. Names and phone numbers stay private.</p>}
        {t.messages.map((m) => (
          <div key={m.id} className={`flex ${m.mine ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${m.mine ? 'bg-leaf text-white' : 'bg-rice-deep'}`}>
              <div className={`text-[10px] font-semibold ${m.mine ? 'text-white/70' : 'text-ink-faint'}`}>{m.label}</div>
              {m.body}
              {!m.mine && t.viewer !== 'admin' && !m.reported && (
                <button className="ml-2 text-[10px] underline opacity-60" onClick={() => act({ action: 'report', messageId: m.id })}>
                  report
                </button>
              )}
              {m.reported && <span className="ml-2 text-[10px] opacity-60">reported</span>}
            </div>
          </div>
        ))}
        <div ref={end} />
      </div>
      {canWrite ? (
        <>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {t.quickReplies.map((q) => (
              <button
                key={q.key}
                disabled={busy}
                onClick={() => (q.key === 'refund' && onRefund ? (setBody(q.text), onRefund()) : act({ action: 'send', quickReplyKey: q.key }))}
                className="min-h-[36px] rounded-pill border border-rice-line bg-white px-3 text-xs font-medium text-ink-soft hover:border-leaf/40"
              >
                {q.text}
              </button>
            ))}
          </div>
          <form
            className="mt-2 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (body.trim()) act({ action: 'send', body });
            }}
          >
            <Input value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write a message" maxLength={500} aria-label="Message" />
            <Button type="submit" loading={busy} disabled={!body.trim()}>
              Send
            </Button>
          </form>
        </>
      ) : (
        <p className="mt-2 text-xs text-ink-faint">{t.state.reason ?? (t.viewer === 'admin' ? 'Read-only (complaint review).' : 'Conversation closed.')}</p>
      )}
    </Card>
  );
}
