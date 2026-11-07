import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { listFavourites } from '@/lib/favourites';
import { getPlatformSettings } from '@/lib/db/platform';
import { Card, EmptyState } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function FavouritesPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/favourites');
  const s = await getPlatformSettings();
  const rows = s.favouritesEnabled ? await listFavourites(session.uid) : [];
  return (
    <div className="mx-auto max-w-lg pt-6">
      <h1 className="text-2xl font-bold">Your favourite kitchens</h1>
      {rows.length === 0 ? (
        <div className="mt-6"><EmptyState emoji="♡" title="No favourites yet" body="Tap the heart on a kitchen to follow it. We will tell you when it cooks." /></div>
      ) : (
        <div className="mt-4 space-y-3" data-testid="favourites">
          {rows.map((r) => (
            <Link key={r.sellerId} href={`/kitchen/${r.sellerId}`} className="block">
              <Card className="flex items-center justify-between p-4">
                <span><span className="font-semibold">{r.kitchen}</span><span className="block text-xs text-ink-faint">{r.rating > 0 ? `★ ${r.rating.toFixed(1)} · ` : ''}{r.closedToday ? 'Closed today' : r.notifyCooking ? 'You get cooking alerts' : 'No alerts'}</span></span>
                <span aria-hidden>›</span>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
