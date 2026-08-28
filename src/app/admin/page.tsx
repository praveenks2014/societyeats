'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Card, Skeleton } from '@/components/ui';
import { formatINR } from '@/lib/money';

type Stats = {
  totalOrders: number;
  activeOrders: number;
  unassigned: number;
  gmvPaise: number;
  commissionPaise: number;
  sellersAwaitingApproval: number;
  fssaiQueue: number;
  providersDown: number;
};

export default function AdminOverview() {
  const [stats, setStats] = useState<Stats | null>(null);
  useEffect(() => {
    fetch('/api/admin/summary')
      .then((r) => r.json())
      .then((d) => setStats(d.stats))
      .catch(() => {});
  }, []);

  if (!stats) return <Skeleton className="h-64 w-full" />;

  const tiles: { label: string; value: string; href: string; alert?: boolean }[] = [
    { label: 'Active orders', value: String(stats.activeOrders), href: '/admin/orders' },
    { label: 'Riderless orders', value: String(stats.unassigned), href: '/admin/orders', alert: stats.unassigned > 0 },
    { label: 'GMV (completed)', value: formatINR(stats.gmvPaise), href: '/admin/orders' },
    { label: 'Commission earned', value: formatINR(stats.commissionPaise), href: '/admin/orders' },
    { label: 'Sellers to approve', value: String(stats.sellersAwaitingApproval), href: '/admin/sellers', alert: stats.sellersAwaitingApproval > 0 },
    { label: 'FSSAI queue', value: String(stats.fssaiQueue), href: '/admin/fssai', alert: stats.fssaiQueue > 0 },
    { label: 'Providers disabled', value: String(stats.providersDown), href: '/admin/providers', alert: stats.providersDown > 0 },
    { label: 'All-time orders', value: String(stats.totalOrders), href: '/admin/orders' },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold">Overview</h1>
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tiles.map((t) => (
          <Link key={t.label} href={t.href}>
            <Card className={`p-4 transition-shadow hover:shadow-lift ${t.alert ? 'border-chili bg-chili-tint/40' : ''}`}>
              <div className="text-xl font-bold">{t.value}</div>
              <div className="mt-0.5 text-xs text-ink-faint">{t.label}</div>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
