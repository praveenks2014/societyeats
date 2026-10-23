'use client';

import { useEffect, useState } from 'react';
import { Badge, Card, EmptyState, SectionTitle, Skeleton } from '@/components/ui';
import { ShareButton } from '@/components/share-button';
import { useToast } from '@/components/providers';
import { formatINR } from '@/lib/money';

type Data = {
  referralCode: string;
  creditPaise: number;
  capPerUser: number;
  grantedCount: number;
  availablePaise: number;
  credits: { id: number; amountInPaise: number; status: 'available' | 'applied'; createdAt: string }[];
};

export function ReferClient() {
  const [data, setData] = useState<Data | null>(null);
  const [link, setLink] = useState('');
  const toast = useToast();

  useEffect(() => {
    fetch('/api/referrals')
      .then((r) => r.json())
      .then(setData)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (data) setLink(`${window.location.origin}/register?ref=${data.referralCode}`);
  }, [data]);

  if (!data) return <Skeleton className="mt-6 h-64 w-full" />;

  const capped = data.grantedCount >= data.capPerUser;

  return (
    <div className="mx-auto max-w-lg pt-6">
      <h1 className="text-2xl font-bold">Invite your neighbours</h1>
      <p className="mt-1.5 text-sm text-ink-soft">
        Share your code — the first time a neighbour you invite completes their first order, you
        get {formatINR(data.creditPaise)} credit toward your own next order.
      </p>

      <Card className="mt-5 p-4">
        <div className="eyebrow">YOUR INVITE CODE</div>
        <div className="mt-1 flex items-center justify-between gap-3">
          <span className="font-display text-2xl font-bold tracking-wide">{data.referralCode}</span>
          <button
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(link);
                toast('Link copied!');
              } catch {
                toast('Could not copy — share directly instead', 'err');
              }
            }}
            className="rounded-xl border border-rice-line px-3 py-1.5 text-xs font-semibold text-ink-soft hover:border-leaf/40"
          >
            Copy link
          </button>
        </div>
        <div className="mt-3">
          <ShareButton
            text="Come join PadosiPlate — home-cooked food from our own society, delivered by our neighbours 🍲"
            url={link}
            className="w-full"
          />
        </div>
      </Card>

      <Card className="mt-4 p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="eyebrow">AVAILABLE CREDIT</div>
            <div className="mt-0.5 text-2xl font-bold text-leaf">{formatINR(data.availablePaise)}</div>
          </div>
          <Badge tone={capped ? 'neutral' : 'green'}>
            {data.grantedCount} / {data.capPerUser} earned
          </Badge>
        </div>
        {capped && (
          <p className="mt-2 text-xs text-ink-faint">
            You&apos;ve reached the referral credit cap — thanks for spreading the word! 🎉
          </p>
        )}
        <p className="mt-2 text-xs text-ink-faint">
          Available credit is applied automatically at your next checkout (you can opt out there).
        </p>
      </Card>

      <section className="mt-8">
        <SectionTitle eyebrow="HISTORY" title="Your referral credits" />
        {data.credits.length === 0 ? (
          <EmptyState emoji="🎁" title="No credits yet" body="Share your code above to get started." />
        ) : (
          <div className="space-y-2">
            {data.credits.map((c) => (
              <Card key={c.id} className="flex items-center justify-between p-3.5">
                <div className="text-sm">
                  <div className="font-semibold">{formatINR(c.amountInPaise)} credit</div>
                  <div className="text-xs text-ink-faint">
                    {new Date(c.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </div>
                </div>
                <Badge tone={c.status === 'available' ? 'green' : 'neutral'}>
                  {c.status === 'available' ? 'Available' : 'Used'}
                </Badge>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
