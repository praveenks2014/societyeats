'use client';

import { useEffect, useState } from 'react';
import { Badge, Button, Card, Skeleton } from '@/components/ui';
import { useToast } from '@/components/providers';

type SellerRow = {
  userId: number;
  kitchenName: string;
  name: string;
  phone: string;
  society: string | null;
  isApproved: boolean;
  fssaiStatus: string;
  fssaiNumber: string | null;
  rating: number;
  ratingCount: number;
};

export default function AdminSellers() {
  const [rows, setRows] = useState<SellerRow[] | null>(null);
  const toast = useToast();

  function load() {
    fetch('/api/admin/sellers')
      .then((r) => r.json())
      .then((d) => setRows(d.sellers))
      .catch(() => {});
  }
  useEffect(load, []);

  async function setApproved(userId: number, isApproved: boolean) {
    const res = await fetch('/api/admin/sellers', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, isApproved }),
    });
    if (!res.ok) {
      toast('Could not update', 'err');
      return;
    }
    toast(isApproved ? 'Kitchen approved ✅' : 'Kitchen suspended');
    load();
  }

  if (!rows) return <Skeleton className="h-64 w-full" />;

  return (
    <div>
      <h1 className="text-2xl font-bold">Sellers</h1>
      <div className="mt-5 space-y-3">
        {rows.map((s) => (
          <Card key={s.userId} className="flex flex-wrap items-center gap-3 p-4">
            <div className="min-w-0 flex-1">
              <div className="font-semibold">{s.kitchenName}</div>
              <div className="text-xs text-ink-faint">
                {s.name} · {s.phone} · {s.society ?? 'No society'}
                {s.rating > 0 && ` · ★ ${s.rating.toFixed(1)} (${s.ratingCount})`}
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {s.fssaiStatus === 'verified' && <Badge tone="green">FSSAI ✓ {s.fssaiNumber}</Badge>}
                {s.fssaiStatus === 'pending_application' && <Badge tone="amber">FSSAI Pending</Badge>}
                {s.fssaiStatus === 'unverified' && <Badge tone="red">No FSSAI</Badge>}
                {s.isApproved ? <Badge tone="green">Approved</Badge> : <Badge tone="neutral">Awaiting approval</Badge>}
              </div>
            </div>
            <Button
              size="sm"
              variant={s.isApproved ? 'ghost' : 'primary'}
              onClick={() => setApproved(s.userId, !s.isApproved)}
            >
              {s.isApproved ? 'Suspend' : 'Approve'}
            </Button>
          </Card>
        ))}
      </div>
    </div>
  );
}
