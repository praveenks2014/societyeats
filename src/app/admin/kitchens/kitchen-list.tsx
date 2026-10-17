'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Badge, Card, EmptyState, Select, Skeleton } from '@/components/ui';

export type KitchenRow = {
  userId: number;
  kitchenName: string;
  ownerName: string;
  blocked: boolean;
  society: string | null;
  tower: string | null;
  state: string;
  submittedAt: string | null;
  fssaiStatus: string;
  subscription: string;
  subscriptionDaysLeft: number | null;
  dishes: number;
  pendingDishes: number;
  isFeatured: boolean;
};

const STATE_TONE: Record<string, 'green' | 'amber' | 'red' | 'neutral'> = { approved: 'green', submitted: 'amber', changes_requested: 'amber', rejected: 'red', delisted: 'red', draft: 'neutral' };

export function KitchenList({ initialState }: { initialState: string }) {
  const [state, setState] = useState(initialState);
  const [rows, setRows] = useState<KitchenRow[] | null>(null);
  useEffect(() => {
    setRows(null);
    fetch(`/api/admin/kitchens?state=${state}`).then((r) => r.json()).then((d) => setRows(d.kitchens)).catch(() => {});
  }, [state]);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{initialState === 'submitted' ? 'Listing requests' : 'Kitchens'}</h1>
        <Select value={state} onChange={(e) => setState(e.target.value)} className="!w-auto" aria-label="Filter by state">
          {['submitted', 'changes_requested', 'approved', 'delisted', 'rejected', 'draft', 'all'].map((s) => (
            <option key={s} value={s}>{s.replace('_', ' ')}</option>
          ))}
        </Select>
      </div>
      {initialState === 'submitted' && (
        <p className="mt-1 text-sm text-ink-soft">Open a request to verify the profile, photos, FSSAI documents, UPI ID, dishes and subscription — then approve, request changes or reject.</p>
      )}
      {!rows ? (
        <Skeleton className="mt-5 h-40 w-full" />
      ) : rows.length === 0 ? (
        <div className="mt-6"><EmptyState emoji="✅" title="Nothing here" body={`No kitchens in “${state.replace('_', ' ')}”.`} /></div>
      ) : (
        <div className="mt-5 space-y-3">
          {rows.map((k) => (
            <Link key={k.userId} href={`/admin/kitchens/${k.userId}`} className="block" data-testid={`kitchen-${k.userId}`}>
              <Card className="p-4 transition-shadow hover:shadow-lift">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold">{k.kitchenName} {k.isFeatured && '⭐'}</div>
                    <div className="text-xs text-ink-faint">{k.ownerName} · {k.society ?? 'no society'}{k.tower ? ` · ${k.tower}` : ''}</div>
                  </div>
                  <Badge tone={STATE_TONE[k.state] ?? 'neutral'}>{k.state.replace('_', ' ')}</Badge>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
                  <Badge tone={k.fssaiStatus === 'verified' ? 'green' : 'amber'}>FSSAI {k.fssaiStatus.replaceAll('_', ' ')}</Badge>
                  <Badge tone={['active', 'waived'].includes(k.subscription) ? 'green' : k.subscription === 'grace' ? 'amber' : 'red'}>
                    Sub: {k.subscription}{k.subscriptionDaysLeft != null && k.subscription !== 'expired' ? ` · ${k.subscriptionDaysLeft}d` : ''}
                  </Badge>
                  <Badge tone="neutral">{k.dishes} dishes{k.pendingDishes ? ` (${k.pendingDishes} to review)` : ''}</Badge>
                  {k.blocked && <Badge tone="red">blocked</Badge>}
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

