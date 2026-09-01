'use client';

import { useEffect, useState } from 'react';
import { Button, Card, EmptyState, Skeleton, Textarea } from '@/components/ui';
import { useToast } from '@/components/providers';

type Review = {
  id: number;
  rating: number;
  text: string | null;
  buyerName: string;
  createdAt: string;
  sellerReplyText: string | null;
};

export default function SellerReviews() {
  const [rows, setRows] = useState<Review[] | null>(null);
  const toast = useToast();

  function load() {
    fetch('/api/seller/reviews')
      .then((r) => r.json())
      .then((d) => setRows(d.reviews))
      .catch(() => {});
  }
  useEffect(load, []);

  if (!rows) return <Skeleton className="mx-auto h-64 w-full max-w-2xl" />;

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-bold">Reviews</h1>
      <p className="mt-1 text-sm text-ink-soft">
        What buyers say after their order is delivered/collected. You can reply once per review.
      </p>

      {rows.length === 0 ? (
        <EmptyState emoji="⭐" title="No reviews yet" body="Reviews appear here once buyers rate a delivered order." />
      ) : (
        <div className="mt-5 space-y-3">
          {rows.map((r) => (
            <Card key={r.id} className="p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">{r.buyerName}</span>
                <span className="rounded-md bg-leaf px-1.5 py-0.5 text-xs font-bold text-white">★ {r.rating}</span>
              </div>
              {r.text && <p className="mt-1.5 text-sm text-ink-soft">{r.text}</p>}
              {r.sellerReplyText ? (
                <div className="mt-2 rounded-xl bg-rice-deep px-3 py-2 text-sm">
                  <span className="font-semibold">Your reply: </span>
                  {r.sellerReplyText}
                </div>
              ) : (
                <ReplyForm reviewId={r.id} onDone={load} toast={toast} />
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function ReplyForm({
  reviewId,
  onDone,
  toast,
}: {
  reviewId: number;
  onDone: () => void;
  toast: (msg: string, tone?: 'ok' | 'err') => void;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    const res = await fetch(`/api/seller/reviews/${reviewId}/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    const d = await res.json();
    setBusy(false);
    if (!res.ok) {
      toast(d.error || 'Could not send reply', 'err');
      return;
    }
    toast('Reply sent');
    onDone();
  }

  return (
    <div className="mt-2 flex items-start gap-2">
      <Textarea
        rows={1}
        placeholder="Reply to this review (once)"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <Button size="sm" loading={busy} disabled={!text.trim()} onClick={submit}>
        Reply
      </Button>
    </div>
  );
}
