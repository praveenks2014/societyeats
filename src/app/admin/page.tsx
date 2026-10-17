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
  platformFeePaise: number;
  sellersAwaitingApproval: number;
  fssaiQueue: number;
  providersDown: number;
  openComplaints: number;
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
    { label: 'Food sold (paid to kitchens)', value: formatINR(stats.gmvPaise), href: '/admin/orders' },
    { label: 'Platform fees (completed)', value: formatINR(stats.platformFeePaise), href: '/admin/revenue' },
    { label: 'Listing requests', value: String(stats.sellersAwaitingApproval), href: '/admin/kitchens/requests', alert: stats.sellersAwaitingApproval > 0 },
    { label: 'FSSAI queue', value: String(stats.fssaiQueue), href: '/admin/fssai', alert: stats.fssaiQueue > 0 },
    { label: 'Open complaints', value: String(stats.openComplaints), href: '/admin/complaints', alert: stats.openComplaints > 0 },
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
