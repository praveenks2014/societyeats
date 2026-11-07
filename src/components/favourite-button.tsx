'use client';

import { useEffect, useState } from 'react';
import { useToast } from '@/components/providers';

/** Heart on a kitchen page. Hidden for visitors who are not signed in; “Tell me when it cooks” is part of following. */
export function FavouriteButton({ sellerId }: { sellerId: number }) {
  const toast = useToast();
  const [state, setState] = useState<{ favourite: boolean; notifyCooking: boolean } | null>(null);
  useEffect(() => {
    fetch(`/api/favourites/${sellerId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setState)
      .catch(() => {});
  }, [sellerId]);
  if (!state) return null;
  async function toggle() {
    const on = !state!.favourite;
    const res = await fetch(`/api/favourites/${sellerId}`, { method: on ? 'PUT' : 'DELETE', headers: { 'Content-Type': 'application/json' }, body: on ? JSON.stringify({ notifyCooking: true }) : undefined });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return toast(d.error || 'Could not save', 'err');
    setState({ favourite: on, notifyCooking: d.notifyCooking ?? true });
    toast(on ? 'Added to your favourites. We will tell you when they cook.' : 'Removed from favourites');
  }
  async function setNotify(v: boolean) {
    const res = await fetch(`/api/favourites/${sellerId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notifyCooking: v }) });
    if (res.ok) setState({ favourite: true, notifyCooking: v });
  }
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button onClick={toggle} aria-pressed={state.favourite} aria-label={state.favourite ? 'Remove from favourites' : 'Add to favourites'} className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-pill border px-4 text-sm font-semibold ${state.favourite ? 'border-chili bg-chili-tint text-chili-dark' : 'border-rice-line bg-white text-ink-soft'}`} data-testid="favourite">
        <span aria-hidden>{state.favourite ? '♥' : '♡'}</span> {state.favourite ? 'Favourite' : 'Add to favourites'}
      </button>
      {state.favourite && (
        <label className="flex min-h-[44px] items-center gap-2 text-xs text-ink-soft">
          <input type="checkbox" className="h-5 w-5 accent-leaf" checked={state.notifyCooking} onChange={(e) => setNotify(e.target.checked)} data-testid="notify-cooking" />
          Tell me when this kitchen is cooking
        </label>
      )}
    </div>
  );
}
