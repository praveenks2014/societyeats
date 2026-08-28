'use client';

import { useState } from 'react';
import { Modal, Button, Badge } from '@/components/ui';
import { formatINR } from '@/lib/money';

/**
 * MOCK_MODE stand-in for Razorpay Checkout: a styled payment sheet with a
 * guaranteed-success button and a simulate-failure button for demos.
 */
export function MockCheckoutSheet({
  open,
  amountInPaise,
  orderId,
  onResult,
  onClose,
}: {
  open: boolean;
  amountInPaise: number;
  orderId: number | null;
  onResult: (outcome: 'success' | 'failure') => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState<'success' | 'failure' | null>(null);

  async function pick(outcome: 'success' | 'failure') {
    setBusy(outcome);
    await onResult(outcome);
    setBusy(null);
  }

  return (
    <Modal open={open} onClose={() => !busy && onClose()} sheet>
      <div className="flex items-center justify-between">
        <div>
          <div className="font-display text-lg font-bold">GharSe Pay</div>
          <div className="text-xs text-ink-faint">Order #{orderId} · UPI / Cards / Netbanking</div>
        </div>
        <Badge tone="amber">MOCK MODE</Badge>
      </div>

      <div className="mt-5 rounded-2xl bg-white p-4 text-center shadow-card">
        <div className="eyebrow">AMOUNT PAYABLE</div>
        <div className="mt-1 text-3xl font-bold">{formatINR(amountInPaise)}</div>
      </div>

      <div className="mt-4 space-y-2 rounded-2xl border border-rice-line bg-white p-3">
        {['🟣 PhonePe UPI', '🔵 Paytm UPI', '💳 HDFC Credit Card ··4242'].map((m, i) => (
          <label key={m} className="flex items-center gap-3 rounded-xl px-2 py-2 text-sm">
            <input type="radio" name="mock-method" defaultChecked={i === 0} className="accent-leaf" />
            {m}
          </label>
        ))}
      </div>

      <div className="mt-5 space-y-2.5">
        <Button size="lg" className="w-full" loading={busy === 'success'} disabled={busy === 'failure'} onClick={() => pick('success')}>
          Pay {formatINR(amountInPaise)} (test)
        </Button>
        <Button
          variant="ghost"
          className="w-full text-chili"
          loading={busy === 'failure'}
          disabled={busy === 'success'}
          onClick={() => pick('failure')}
        >
          Simulate payment failure
        </Button>
      </div>
      <p className="mt-3 text-center text-[11px] text-ink-faint">
        No real money moves. Set MOCK_MODE=false with Razorpay test keys for the real checkout.
      </p>
    </Modal>
  );
}
