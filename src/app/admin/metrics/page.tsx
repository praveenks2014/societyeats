'use client';

import { useEffect, useState } from 'react';
import { Badge, Button, Card, Input, Select, Skeleton } from '@/components/ui';
import { useToast } from '@/components/providers';
import { formatINR } from '@/lib/money';

type FulfillmentMix = { selfPickupPct: number; sellerDeliveryPct: number; platformDeliveryPct: number };

type WeeklyMetricRow = {
  weekNumber: number;
  weekStart: string;
  weekEnd: string;
  householdsRegistered: number;
  targetHouseholds: number;
  penetrationPct: number;
  weeklyActiveBuyers: number;
  repeatOrderRatePct: number;
  week4RetentionPct: number | null;
  ordersThisWeek: number;
  aovInPaise: number;
  fulfillmentMix: FulfillmentMix;
  activeSellers: number;
  ordersPerActiveSeller: number;
  sellerChurnCount: number;
  sellerEligibleCount: number;
  sellerChurnPct: number;
  netRevenuePerOrderPaise: number;
  refundComplaintRatePct: number;
};

type KillPivotCheckpoint = {
  checkpoint: 8 | 14;
  pilotWeek: number;
  due: boolean;
  weeksRemaining: number;
  status: 'pass' | 'fail' | 'pending';
  failingMetrics: string[];
  thresholds: { penetrationPct: number; retentionPct: number; refundComplaintRatePct: number };
};

type SocietyData = {
  society: { id: number; name: string; targetHouseholds: number };
  weeks: WeeklyMetricRow[];
  targets: { buyerRetentionTargetPct: number; refundComplaintRateTargetPct: number };
  killPivot: { week8: KillPivotCheckpoint; week14: KillPivotCheckpoint };
};

type SocietyOption = { id: number; name: string; targetHouseholds: number };

const pct = (n: number) => `${n.toFixed(1)}%`;

export default function AdminMetrics() {
  const [societies, setSocieties] = useState<SocietyOption[] | null>(null);
  const [societyId, setSocietyId] = useState<number | null>(null);
  const [data, setData] = useState<SocietyData | null>(null);
  const [targetInput, setTargetInput] = useState('');
  const [savingTarget, setSavingTarget] = useState(false);
  const toast = useToast();

  function load(id?: number) {
    const qs = id ? `?societyId=${id}` : '';
    fetch(`/api/admin/metrics${qs}`)
      .then((r) => r.json())
      .then((d) => {
        setSocieties(d.societies);
        setData(d.data);
        if (d.data) {
          setSocietyId(d.data.society.id);
          setTargetInput(String(d.data.society.targetHouseholds));
        }
      })
      .catch(() => {});
  }
  useEffect(() => load(), []);

  async function saveTarget() {
    if (!societyId) return;
    const targetHouseholds = Number(targetInput);
    if (!Number.isFinite(targetHouseholds) || targetHouseholds <= 0) {
      toast('Enter a valid household target', 'err');
      return;
    }
    setSavingTarget(true);
    const res = await fetch('/api/admin/metrics', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ societyId, targetHouseholds }),
    });
    const d = await res.json();
    setSavingTarget(false);
    if (!res.ok) {
      toast(d.error || 'Could not save', 'err');
      return;
    }
    setData(d.data);
    toast('Target households updated ✅');
  }

  if (!societies) return <Skeleton className="h-64 w-full" />;
  if (societies.length === 0) {
    return <p className="text-sm text-ink-soft">No societies yet.</p>;
  }
  if (!data) return <Skeleton className="h-64 w-full" />;

  const { weeks, targets, killPivot } = data;

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Pilot metrics</h1>
          <p className="mt-1 text-sm text-ink-soft">
            Weekly targets vs. actuals for one society — 8-week rolling window, ending today.
          </p>
        </div>
        <a
          href={`/api/admin/metrics/export?societyId=${societyId}`}
          className="shrink-0 rounded-xl border border-leaf px-4 py-2 text-sm font-semibold text-leaf hover:bg-leaf-tint"
        >
          ⬇ Export CSV
        </a>
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div className="min-w-[220px]">
          <div className="mb-1.5 text-sm font-medium">Society</div>
          <Select
            value={societyId ?? ''}
            onChange={(e) => load(Number(e.target.value))}
          >
            {societies.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <div className="mb-1.5 text-sm font-medium">Target households</div>
          <div className="flex gap-2">
            <Input
              inputMode="numeric"
              className="w-28"
              value={targetInput}
              onChange={(e) => setTargetInput(e.target.value.replace(/\D/g, ''))}
            />
            <Button size="md" loading={savingTarget} onClick={saveTarget}>
              Save
            </Button>
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <CheckpointBanner cp={killPivot.week8} />
        <CheckpointBanner cp={killPivot.week14} />
      </div>

      <div className="mt-3 text-xs text-ink-faint">
        Fixed targets: week-4 buyer retention ≥ {targets.buyerRetentionTargetPct}% · refund/complaint rate &lt;{' '}
        {targets.refundComplaintRateTargetPct}%. Kill/pivot checkpoint thresholds are admin-editable in Settings.
      </div>

      <div className="mt-5 overflow-x-auto rounded-card border border-rice-line bg-white shadow-card">
        <table className="w-full min-w-[1500px] text-sm">
          <thead>
            <tr className="border-b border-rice-line text-left text-xs uppercase tracking-wide text-ink-faint">
              <th className="px-3 py-2.5">Week</th>
              <th className="px-3 py-2.5">Households (actual / target)</th>
              <th className="px-3 py-2.5">Penetration</th>
              <th className="px-3 py-2.5">Weekly active buyers</th>
              <th className="px-3 py-2.5">Week-4 retention</th>
              <th className="px-3 py-2.5">Repeat order rate</th>
              <th className="px-3 py-2.5">Orders</th>
              <th className="px-3 py-2.5">AOV</th>
              <th className="px-3 py-2.5">Fulfillment mix (pickup / seller / platform)</th>
              <th className="px-3 py-2.5">Active sellers</th>
              <th className="px-3 py-2.5">Orders / active seller</th>
              <th className="px-3 py-2.5">Seller churn</th>
              <th className="px-3 py-2.5">Net revenue / order</th>
              <th className="px-3 py-2.5">Refund/complaint rate</th>
            </tr>
          </thead>
          <tbody>
            {weeks.map((w) => (
              <tr key={w.weekNumber} className="border-b border-rice-line align-top last:border-0">
                <td className="px-3 py-2.5 font-medium">
                  W{w.weekNumber}
                  <div className="text-[11px] font-normal text-ink-faint">
                    {fmtDate(w.weekStart)}–{fmtDate(w.weekEnd)}
                  </div>
                </td>
                <td className="px-3 py-2.5">
                  {w.householdsRegistered} / {w.targetHouseholds}
                </td>
                <td className="px-3 py-2.5">{pct(w.penetrationPct)}</td>
                <td className="px-3 py-2.5">{w.weeklyActiveBuyers}</td>
                <td className="px-3 py-2.5">
                  {w.week4RetentionPct == null ? (
                    <span className="text-ink-faint">—</span>
                  ) : (
                    <TargetCell value={w.week4RetentionPct} target={targets.buyerRetentionTargetPct} higherIsBetter />
                  )}
                </td>
                <td className="px-3 py-2.5">{pct(w.repeatOrderRatePct)}</td>
                <td className="px-3 py-2.5">{w.ordersThisWeek}</td>
                <td className="px-3 py-2.5">{formatINR(w.aovInPaise)}</td>
                <td className="px-3 py-2.5">
                  {pct(w.fulfillmentMix.selfPickupPct)} / {pct(w.fulfillmentMix.sellerDeliveryPct)} /{' '}
                  {pct(w.fulfillmentMix.platformDeliveryPct)}
                </td>
                <td className="px-3 py-2.5">{w.activeSellers}</td>
                <td className="px-3 py-2.5">{w.ordersPerActiveSeller.toFixed(1)}</td>
                <td className="px-3 py-2.5">
                  {w.sellerChurnCount} / {w.sellerEligibleCount} ({pct(w.sellerChurnPct)})
                </td>
                <td className="px-3 py-2.5">{formatINR(w.netRevenuePerOrderPaise)}</td>
                <td className="px-3 py-2.5">
                  <TargetCell
                    value={w.refundComplaintRatePct}
                    target={targets.refundComplaintRateTargetPct}
                    higherIsBetter={false}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

/** Renders a percentage with a green/red tint depending on whether it clears the stated target. */
function TargetCell({ value, target, higherIsBetter }: { value: number; target: number; higherIsBetter: boolean }) {
  const meets = higherIsBetter ? value >= target : value <= target;
  return <span className={meets ? 'font-medium text-leaf' : 'font-medium text-chili'}>{pct(value)}</span>;
}

function CheckpointBanner({ cp }: { cp: KillPivotCheckpoint }) {
  const tone = cp.status === 'pass' ? 'green' : cp.status === 'fail' ? 'red' : 'neutral';
  return (
    <Card className={`p-4 ${cp.status === 'fail' ? 'border-chili bg-chili-tint/30' : ''}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="font-semibold">Week {cp.checkpoint} checkpoint</div>
        <Badge tone={tone}>
          {cp.status === 'pending' ? `Due in ${cp.weeksRemaining} wk` : cp.status === 'pass' ? 'On track' : 'Underperforming'}
        </Badge>
      </div>
      {cp.status === 'pending' && (
        <p className="mt-1.5 text-xs text-ink-soft">
          Pilot is in week {cp.pilotWeek} — this checkpoint isn't due yet.
        </p>
      )}
      {cp.status === 'pass' && (
        <p className="mt-1.5 text-xs text-ink-soft">
          Penetration ≥ {cp.thresholds.penetrationPct}%, week-4 retention ≥ {cp.thresholds.retentionPct}%, and
          refund/complaint rate ≤ {cp.thresholds.refundComplaintRatePct}% — all clear.
        </p>
      )}
      {cp.status === 'fail' && (
        <ul className="mt-1.5 list-inside list-disc text-xs text-chili-dark">
          {cp.failingMetrics.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}
    </Card>
  );
}
