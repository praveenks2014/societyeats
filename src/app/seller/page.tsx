'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Badge, Button, Card, Skeleton } from '@/components/ui';
import { formatINR } from '@/lib/money';

type Summary = {
  profile: {
    kitchenName: string;
    isApproved: boolean;
    fssaiStatus: 'verified' | 'pending_application' | 'unverified' | 'awaiting_admin_check';
    fssaiNumber: string | null;
    rating: number;
    ratingCount: number;
  };
  plan: 'free' | 'pro';
  /** FSSAI hardening v3 (DECISIONS.md #119+): see src/lib/fssai/gate.ts's fssaiDeemedGrantInfo(). */
  fssaiDeemedGrant: {
    thresholdDays: number;
    daysElapsed: number;
    daysRemaining: number | null;
    eligible: boolean;
  } | null;
  settings: { commissionHomePct: number };
  stats: {
    listings: number;
    activeListings: number;
    activeOrders: number;
    todayOrders: number;
    todayGrossPaise: number;
  };
};

export default function SellerDashboard() {
  const [data, setData] = useState<Summary | null>(null);

  useEffect(() => {
    fetch('/api/seller/summary')
      .then((r) => r.json())
      .then(setData)
      .catch(() => {});
  }, []);

  if (!data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const { profile, stats } = data;
  // FSSAI hardening v3 (DECISIONS.md #119+): mirrors isFssaiEligibleToPublish
  // (src/lib/fssai/gate.ts) — verified, or a FoSCoS filing old enough to be
  // deemed-eligible under the regulation. 'awaiting_admin_check' doesn't get
  // a free pass here on its own; it keeps whatever rights the eligibility
  // check below already grants it (same "prior publishing rights" the
  // compliance page shows in detail).
  const complianceOk = profile.isApproved && (profile.fssaiStatus === 'verified' || !!data.fssaiDeemedGrant?.eligible);

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-bold">{profile.kitchenName}</h1>
      <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-soft">
        {profile.rating > 0 && <span>★ {profile.rating.toFixed(1)} ({profile.ratingCount} ratings)</span>}
        {profile.fssaiStatus === 'verified' && <Badge tone="green">FSSAI Verified ✅</Badge>}
        {profile.fssaiStatus === 'pending_application' && <Badge tone="amber">FSSAI Pending</Badge>}
        {profile.fssaiStatus === 'awaiting_admin_check' && <Badge tone="amber">Verification in progress</Badge>}
        {!profile.isApproved && <Badge tone="red">Awaiting approval</Badge>}
      </div>

      {/* compliance nudges */}
      {!complianceOk && (
        <Card className="mt-5 border-turmeric bg-turmeric-tint/50 p-4">
          <div className="font-semibold">
            {profile.fssaiStatus === 'verified'
              ? '⏳ Your kitchen is awaiting GharSe approval'
              : '🪪 One step before you can publish dishes'}
          </div>
          <p className="mt-1 text-sm text-ink-soft">
            {profile.fssaiStatus === 'verified'
              ? 'Our team approves new kitchens within a few hours. Meanwhile, set up your dishes as drafts.'
              : "Food businesses in India need an FSSAI license. Enter one if you've already got it, or file an application yourself on FoSCoS — GharSe prefills everything and walks you through it."}
          </p>
          {profile.fssaiStatus !== 'verified' && (
            <Link href="/seller/compliance">
              <Button className="mt-3">Go to Compliance →</Button>
            </Link>
          )}
        </Card>
      )}
      {data.fssaiDeemedGrant && !data.fssaiDeemedGrant.eligible && (
        <Card className="mt-4 p-4 text-sm">
          <Badge tone="amber">FSSAI applied</Badge>
          <p className="mt-2 text-ink-soft">
            Your FoSCoS filing is with the department. <strong>{data.fssaiDeemedGrant.daysRemaining} days</strong>{' '}
            until you may be able to go live under the regulation, even without a grant yet — see your{' '}
            <Link href="/seller/compliance" className="font-semibold text-leaf underline">
              Compliance page
            </Link>{' '}
            for details.
          </p>
        </Card>
      )}

      {/* stats */}
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Active orders" value={String(stats.activeOrders)} href="/seller/orders" />
        <Stat label="Live dishes" value={`${stats.activeListings}/${stats.listings}`} href="/seller/listings" />
        <Stat label="Delivered today" value={String(stats.todayOrders)} />
        <Stat label="Today's gross" value={formatINR(stats.todayGrossPaise)} href="/seller/earnings" />
      </div>

      {/* Pro upsell */}
      {data.plan === 'free' ? (
        <Card className="mt-6 overflow-hidden">
          <div className="bg-leaf p-4 text-white">
            <div className="eyebrow !text-turmeric">GHARSE PRO · ₹299/MO</div>
            <div className="mt-1 font-display text-lg font-bold">Get the featured carousel slot</div>
            <ul className="mt-2 space-y-1 text-sm text-white/85">
              <li>⭐ Featured placement on the home screen</li>
              <li>🪪 Priority FSSAI assistance (48h filing)</li>
              <li>📈 Demand analytics for your society</li>
            </ul>
            <Button className="mt-3" onClick={() => alert('Pro subscriptions open soon — Phase 2!')}>
              Upgrade to Pro
            </Button>
          </div>
        </Card>
      ) : (
        <Card className="mt-6 p-4">
          <Badge tone="green">PRO KITCHEN ⭐</Badge>
          <p className="mt-2 text-sm text-ink-soft">
            You&apos;re on GharSe Pro — featured placement and priority FSSAI support are active.
          </p>
        </Card>
      )}
    </div>
  );
}

function Stat({ label, value, href }: { label: string; value: string; href?: string }) {
  const inner = (
    <Card className="p-3.5 transition-shadow hover:shadow-lift">
      <div className="text-xl font-bold">{value}</div>
      <div className="mt-0.5 text-xs text-ink-faint">{label}</div>
    </Card>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}
