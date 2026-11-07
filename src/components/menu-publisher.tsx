'use client';

import { useEffect, useState } from 'react';
import { Button, Card, Input } from '@/components/ui';
import { useToast } from '@/components/providers';

type Dish = { id: number; title: string; isActive: boolean; moderationStatus: string };
type Posted = { post: { id: number; forDate: string; note: string | null; listingIds: number[]; dishes: string[] } | null; share?: { url: string; text: string; waUrl: string } };

/** “Today's menu”: pick dishes, publish. Followers who asked for alerts are told once a day; a WhatsApp share link is ready. */
export function MenuPublisher({ dishes }: { dishes: Dish[] }) {
  const toast = useToast();
  const live = dishes.filter((d) => d.isActive && d.moderationStatus === 'approved');
  const [picked, setPicked] = useState<number[]>([]);
  const [note, setNote] = useState('');
  const [posted, setPosted] = useState<Posted | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    fetch('/api/seller/menu').then((r) => r.json()).then((d: Posted) => {
      setPosted(d);
      if (d.post) {
        setPicked(d.post.listingIds);
        setNote(d.post.note ?? '');
      }
    });
  }, []);
  if (live.length === 0) return null;
  async function publish() {
    setBusy(true);
    const res = await fetch('/api/seller/menu', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ listingIds: picked, note }) });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return toast(d.error || 'Could not publish', 'err');
    setPosted(d);
    toast(d.alerted ? `Published. ${d.alerted} follower${d.alerted === 1 ? '' : 's'} told.` : 'Menu published');
  }
  return (
    <Card className="mt-5 space-y-3 p-4" data-testid="menu-publisher">
      <div className="eyebrow">TODAY&apos;S MENU</div>
      <div className="flex flex-wrap gap-1.5">
        {live.map((d) => (
          <button key={d.id} type="button" aria-pressed={picked.includes(d.id)} onClick={() => setPicked((p) => (p.includes(d.id) ? p.filter((x) => x !== d.id) : [...p, d.id]))} className={`min-h-[44px] rounded-pill px-3 text-xs font-semibold ${picked.includes(d.id) ? 'bg-leaf text-white' : 'bg-rice-deep text-ink-soft'}`} data-testid={`menu-dish-${d.id}`}>{d.title}</button>
        ))}
      </div>
      <Input placeholder="A line for your neighbours (optional)" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} data-testid="menu-note" />
      <div className="flex flex-wrap items-center gap-2">
        <Button loading={busy} disabled={picked.length === 0} onClick={publish} data-testid="menu-publish">{posted?.post ? 'Update today’s menu' : 'Publish today’s menu'}</Button>
        {posted?.share && (
          <a href={posted.share.waUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-[44px] items-center rounded-xl bg-[#25D366] px-4 text-sm font-bold text-white" data-testid="menu-share">Share on WhatsApp</a>
        )}
      </div>
      {posted?.share && <p className="text-xs text-ink-faint" data-testid="menu-url">{posted.share.url}</p>}
    </Card>
  );
}
