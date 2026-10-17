'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Badge, Button, Card, Skeleton } from '@/components/ui';
import { useToast } from '@/components/providers';
import { formatINR } from '@/lib/money';

type ChecklistItem = { key: string; label: string; done: boolean; href: string; hint?: string };
type Summary = {
  profile: {
    kitchenName: string;
    isApproved: boolean;
    listingState: string;
    fssaiStatus: 'verified' | 'pending_application' | 'unverified' | 'awaiting_admin_check';
    fssaiNumber: string | null;
    rating: number;
    ratingCount: number;
  };
  fssaiDeemedGrant: { thresholdDays: number; daysElapsed: number; daysRemaining: number | null; eligible: boolean } | null;
  subscription: { status: string; daysLeft: number | null; inGrace: boolean; endsAt: string | null };
  inboxUnread: number;
  refundsDue: { count: number; totalPaise: number };
  stats: { listings: number; activeListings: number; activeOrders: number; todayOrders: number; todayFoodPaise: number };
};
type Request = { items: ChecklistItem[]; requestReady: boolean; state: string; reviewNote: string | null; live: boolean; gateReasons: string[] };

export default function SellerDashboard() {
  const [data, setData] = useState<Summary | null>(null);
  const [req, setReq] = useState<Request | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const load = () => {
    fetch('/api/seller/summary').then((r) => r.json()).then(setData).catch(() => {});
    fetch('/api/seller/listing-request').then((r) => r.json()).then(setReq).catch(() => {});
  };
  useEffect(load, []);

  async function submit() {
    setBusy(true);
    const res = await fetch('/api/seller/listing-request', { method: 'POST' });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return toast(d.error || 'Could not submit', 'err');
    toast('Listing request sent for review ✅');
    load();
  }

  if (!data || !req) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const { profile, stats } = data;
  const doneCount = req.items.filter((i) => i.done).length;

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-bold">{profile.kitchenName}</h1>
      <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-soft">
        {profile.rating > 0 && <span>★ {profile.rating.toFixed(1)} ({profile.ratingCount} ratings)</span>}
        {profile.fssaiStatus === 'verified' && <Badge tone="green">FSSAI Verified ✅</Badge>}
        {profile.fssaiStatus === 'pending_application' && <Badge tone="amber">FSSAI Pending</Badge>}
        {profile.fssaiStatus === 'awaiting_admin_check' && <Badge tone="amber">Verification in progress</Badge>}
        <Badge tone={req.live ? 'green' : 'neutral'}>{req.live ? 'Live to neighbours' : 'Not live yet'}</Badge>
      </div>

      {/* onboarding checklist → listing request */}
      {!req.live && (
        <Card className="mt-5 p-4" data-testid="seller-checklist">
          <div className="flex items-center justify-between">
            <div className="eyebrow">GET YOUR KITCHEN LIVE</div>
            <span className="text-xs text-ink-faint">{doneCount}/{req.items.length}</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-pill bg-rice-deep">
            <div className="h-full bg-leaf transition-all" style={{ width: `${(doneCount / req.items.length) * 100}%` }} />
          </div>
          <ol className="mt-3 space-y-1">
            {req.items.map((i) => (
              <li key={i.key}>
                <Link href={i.href} className="flex min-h-[44px] items-center gap-3 rounded-xl px-2 text-sm hover:bg-rice">
                  <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${i.done ? 'bg-leaf text-white' : 'border-2 border-rice-line text-ink-faint'}`} aria-hidden>
                    {i.done ? '✓' : ''}
                  </span>
                  <span className={i.done ? 'text-ink-soft line-through decoration-ink-faint/50' : 'font-medium'}>{i.label}</span>
                  {i.hint && <span className="ml-auto text-xs text-ink-faint">{i.hint}</span>}
                </Link>
              </li>
            ))}
          </ol>
          {req.reviewNote && (
            <p className="mt-3 rounded-xl bg-turmeric-tint px-3 py-2 text-sm" role="status">
              <strong>{req.state === 'rejected' ? 'Not approved: ' : 'Changes requested: '}</strong>{req.reviewNote}
            </p>
          )}
          {['draft', 'changes_requested'].includes(req.state) && (
            <Button className="mt-4 w-full" size="lg" loading={busy} disabled={!req.requestReady} onClick={submit} data-testid="submit-listing-request">
              {req.state === 'changes_requested' ? 'Resubmit for review' : 'Submit listing request'}
            </Button>
          )}
          {req.state === 'submitted' && <p className="mt-3 text-sm text-ink-soft" role="status">✅ Submitted — the PadosiPlate team is reviewing your kitchen.</p>}
          {req.state === 'approved' && req.gateReasons.length > 0 && (
            <p className="mt-3 text-sm text-ink-soft">Approved! Still needed to go live: {req.gateReasons.join('; ')}.</p>
          )}
        </Card>
      )}

      {data.fssaiDeemedGrant && !data.fssaiDeemedGrant.eligible && (
        <Card className="mt-4 p-4 text-sm">
          <Badge tone="amber">FSSAI applied</Badge>
          <p className="mt-2 text-ink-soft">
            Your FoSCoS filing is with the department. <strong>{data.fssaiDeemedGrant.daysRemaining} days</strong>{' '}
            until you may be able to go live under the regulation — see your{' '}
            <Link href="/seller/compliance" className="font-semibold text-leaf underline">FSSAI page</Link>.
          </p>
        </Card>
      )}

      {data.inboxUnread > 0 && (
        <Link href="/seller/inbox" className="mt-4 block rounded-2xl bg-leaf-tint px-4 py-3 text-sm font-medium text-leaf">
          ✉️ You have {data.inboxUnread} unread message{data.inboxUnread === 1 ? '' : 's'} from PadosiPlate
        </Link>
      )}
      {data.refundsDue.count > 0 && (
        <Link href="/seller/refunds-due" className="mt-4 block rounded-2xl bg-chili-tint px-4 py-3 text-sm font-medium text-chili-dark">
          ↩️ You owe buyers {formatINR(data.refundsDue.totalPaise)} in food refunds ({data.refundsDue.count}) — mark them done once you’ve returned the money.
        </Link>
      )}

      {/* stats */}
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Active orders" value={String(stats.activeOrders)} href="/seller/orders" />
        <Stat label="Live dishes" value={`${stats.activeListings}/${stats.listings}`} href="/seller/listings" />
        <Stat label="Completed today" value={String(stats.todayOrders)} />
        <Stat label="Food sold today" value={formatINR(stats.todayFoodPaise)} href="/seller/earnings" />
      </div>

      <Card className="mt-6 p-4">
        <div className="eyebrow">SUBSCRIPTION</div>
        <div className="mt-1 flex items-center justify-between gap-3">
          <div>
            <div className="font-semibold capitalize">
              {data.subscription.status === 'none' ? 'No active plan' : data.subscription.status === 'waived' ? 'Complimentary' : data.subscription.status}
            </div>
            {data.subscription.daysLeft != null && <div className="text-xs text-ink-faint">{data.subscription.daysLeft} day(s) left</div>}
          </div>
          <Link href="/seller/subscription"><Button variant="secondary" size="sm">Manage</Button></Link>
        </div>
      </Card>
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
