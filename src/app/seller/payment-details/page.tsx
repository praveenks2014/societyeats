'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, Field, Input, Skeleton } from '@/components/ui';
import { MockCheckoutSheet } from '@/components/mock-checkout';
import '@/components/razorpay';
import { useToast } from '@/components/providers';

type Details = { upiVpa: string | null; acceptsCash: boolean; verifyStatus: string; verifiedVpa: string | null; registeredName: string | null; complete: boolean };
type Start =
  | { mode: 'mock'; verificationId: number; amountInPaise: number }
  | { mode: 'razorpay'; verificationId: number; amountInPaise: number; keyId: string; razorpayOrderId: string }
  | { mode: 'intent'; verificationId: number; amountInPaise: number; intentUrl: string; qrSvg: string };

const STATUS: Record<string, { label: string; tone: 'green' | 'amber' | 'red' | 'neutral' }> = {
  verified: { label: 'Verified ✅', tone: 'green' },
  pending: { label: 'Waiting for your ₹1 payment', tone: 'amber' },
  needs_manual_review: { label: 'Waiting for admin review', tone: 'amber' },
  mismatch: { label: 'Paid from a different UPI ID', tone: 'red' },
  unverified: { label: 'Not verified', tone: 'neutral' },
};

/** UPI ID + the ₹1 reverse-penny-drop ownership check (reverse penny drop: YOU pay ₹1 from the ID, we refund it). */
export default function PaymentDetailsPage() {
  const toast = useToast();
  const [d, setD] = useState<Details | null>(null);
  const [vpa, setVpa] = useState('');
  const [cash, setCash] = useState(false);
  const [busy, setBusy] = useState(false);
  const [start, setStart] = useState<Start | null>(null);
  const [sheet, setSheet] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch('/api/seller/payment-details');
    const data: Details = await r.json();
    setD(data);
    setVpa(data.upiVpa ?? '');
    setCash(data.acceptsCash);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function save() {
    setBusy(true);
    const res = await fetch('/api/seller/payment-details', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ upiVpa: vpa.trim(), acceptsCash: cash }) });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return toast(body.error || 'Could not save', 'err');
    toast(body.needsVerification ? 'Saved — now verify it with the ₹1 check' : 'Saved ✅');
    load();
  }

  async function begin() {
    setBusy(true);
    const res = await fetch('/api/seller/upi-verify', { method: 'POST' });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return toast(body.error || 'Could not start the check', 'err');
    setStart(body);
    if (body.mode === 'mock') setSheet(true);
    else if (body.mode === 'razorpay') openRazorpay(body);
    load();
  }

  function openRazorpay(s: Extract<Start, { mode: 'razorpay' }>) {
    const launch = () => {
      const rzp = new window.Razorpay!({
        key: s.keyId,
        amount: s.amountInPaise,
        currency: 'INR',
        name: 'PadosiPlate',
        description: 'UPI ownership check (₹1, refunded)',
        order_id: s.razorpayOrderId,
        method: { upi: true, card: false, netbanking: false, wallet: false, emi: false, paylater: false },
        handler: async (resp: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => {
          const v = await fetch('/api/seller/upi-verify/complete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'razorpay', verificationId: s.verificationId, ...resp }) });
          const out = await v.json().catch(() => ({}));
          if (!v.ok) toast(out.error || 'Verification failed', 'err');
          load();
        },
        theme: { color: '#1E4D2B' },
      });
      rzp.open();
    };
    if (window.Razorpay) launch();
    else {
      const sc = document.createElement('script');
      sc.src = 'https://checkout.razorpay.com/v1/checkout.js';
      sc.onload = launch;
      document.body.appendChild(sc);
    }
  }

  async function mockResult(outcome: 'success' | 'failure') {
    if (!start || start.mode !== 'mock') return;
    const res = await fetch('/api/seller/upi-verify/complete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'mock', verificationId: start.verificationId, outcome }) });
    const out = await res.json().catch(() => ({}));
    setSheet(false);
    if (!res.ok) toast(out.error || 'Check failed', 'err');
    else if (out.status === 'verified') toast('UPI ID verified ✅');
    else if (out.status === 'failed') toast('Payment failed (simulated) — you can try again', 'err');
    load();
  }

  async function poll() {
    if (!start) return;
    const res = await fetch('/api/seller/upi-verify/complete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'poll', verificationId: start.verificationId }) });
    const out = await res.json().catch(() => ({}));
    if (out.status === 'verified') toast('UPI ID verified ✅');
    load();
  }

  if (!d) return <Skeleton className="mx-auto h-64 w-full max-w-lg" />;
  const st = STATUS[d.verifyStatus] ?? STATUS.unverified;
  const unchanged = (d.upiVpa ?? '').toLowerCase() === vpa.trim().toLowerCase();
  return (
    <div className="mx-auto max-w-lg space-y-5">
      <div>
        <h1 className="text-2xl font-bold">How buyers pay you</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Buyers pay you <strong>at their door</strong>, after the food arrives, by UPI to the ID below. PadosiPlate never touches your food money. Tip: a UPI <strong>business</strong> ID (PhonePe, Paytm or Google Pay for Business) avoids extra warnings in some apps — a personal ID works too.
        </p>
      </div>

      <Card className="space-y-4 p-4">
        <Field label="Your UPI ID" hint="Like name@bank. Changing it pauses your kitchen until the new ID is verified.">
          <Input value={vpa} onChange={(e) => setVpa(e.target.value)} placeholder="name@okhdfcbank" autoCapitalize="none" data-testid="vpa" />
        </Field>
        <label className="flex min-h-[44px] items-center gap-3 text-sm">
          <input type="checkbox" className="h-5 w-5 accent-leaf" checked={cash} onChange={(e) => setCash(e.target.checked)} />
          I also accept cash at the door
        </label>
        <Button loading={busy} disabled={!vpa.trim() || (unchanged && cash === d.acceptsCash)} onClick={save} data-testid="save-payment">Save</Button>
      </Card>

      <Card className="p-4" data-testid="upi-verify-card">
        <div className="flex items-center justify-between">
          <div className="eyebrow">OWNERSHIP CHECK · ₹1</div>
          <Badge tone={st.tone}>{st.label}</Badge>
        </div>
        {d.verifyStatus === 'verified' ? (
          <p className="mt-2 text-sm" data-testid="verified-info">
            Verified UPI ID <strong>{d.verifiedVpa}</strong>
            {d.registeredName ? <> · name shown to buyers: <strong>{d.registeredName}</strong></> : null}.
          </p>
        ) : (
          <>
            <p className="mt-2 text-sm text-ink-soft">
              Pay <strong>₹1</strong> to PadosiPlate <strong>from the UPI ID above</strong>. This proves it is yours. We refund the ₹1 automatically. Your kitchen cannot go live until this is done.
            </p>
            {d.upiVpa && (
              <Button className="mt-3" size="lg" loading={busy} disabled={!unchanged} onClick={begin} data-testid="start-verify">
                {d.verifyStatus === 'pending' ? 'Try the ₹1 check again' : 'Verify with ₹1'}
              </Button>
            )}
            {!d.upiVpa && <p className="mt-2 text-xs text-ink-faint">Save your UPI ID first.</p>}
          </>
        )}
        {d.verifyStatus === 'mismatch' && <p className="mt-2 text-sm text-chili-dark" role="alert">The ₹1 came from a different UPI ID than the one you saved. Pay from the same ID, or correct it above.</p>}
        {d.verifyStatus === 'needs_manual_review' && <EvidenceUpload verificationId={start?.verificationId ?? null} onDone={load} />}
        {start?.mode === 'intent' && (
          <div className="mt-3 text-center">
            <a href={start.intentUrl} className="flex min-h-[48px] items-center justify-center rounded-xl bg-turmeric px-4 text-base font-bold text-ink md:hidden">Pay ₹1 in my UPI app</a>
            <div className="mt-3 hidden flex-col items-center md:flex" dangerouslySetInnerHTML={{ __html: start.qrSvg }} />
            <Button variant="secondary" className="mt-3" onClick={poll}>I&apos;ve paid — check now</Button>
          </div>
        )}
      </Card>

      <MockCheckoutSheet open={sheet} amountInPaise={100} orderId={null} onResult={mockResult} onClose={() => setSheet(false)} />
    </div>
  );
}

function EvidenceUpload({ verificationId, onDone }: { verificationId: number | null; onDone: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function upload(file: File) {
    if (!verificationId) return toast('Start the check again first', 'err');
    setBusy(true);
    const fd = new FormData();
    fd.append('file', file);
    fd.append('purpose', 'upi_evidence');
    const up = await fetch('/api/uploads', { method: 'POST', body: fd });
    const u = await up.json().catch(() => ({}));
    if (!up.ok) {
      setBusy(false);
      return toast(u.error || 'Upload failed', 'err');
    }
    const key = String(u.url).split('/').pop() ?? '';
    const res = await fetch('/api/seller/upi-verify/evidence', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ verificationId, fileKey: key }) });
    setBusy(false);
    toast(res.ok ? 'Screenshot sent — an admin will confirm' : 'Could not send the screenshot', res.ok ? 'ok' : 'err');
    onDone();
  }
  return (
    <div className="mt-3 rounded-xl bg-turmeric-tint px-3 py-3 text-sm">
      We could not read your UPI ID automatically. Upload a screenshot of the ₹1 debit that shows your UPI ID.
      <label className="mt-2 flex min-h-[44px] cursor-pointer items-center justify-center rounded-xl border-2 border-dashed border-turmeric-deep text-sm font-semibold text-turmeric-deep">
        {busy ? 'Uploading…' : 'Upload screenshot'}
        <input type="file" accept="image/*" className="sr-only" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
      </label>
    </div>
  );
}
