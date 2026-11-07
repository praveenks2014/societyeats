import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { BRAND } from '@/config/brand';
import { getDb } from '@/lib/db';
import { listings, menuPosts, sellerProfiles } from '@/lib/db/schema';
import { inArray } from 'drizzle-orm';
import { formatINR } from '@/lib/money';
import { ShareButton } from '@/components/share-button';

export const dynamic = 'force-dynamic';

async function load(id: number) {
  const db = await getDb();
  const [post] = await db.select().from(menuPosts).where(eq(menuPosts.id, id));
  if (!post) return null;
  const [k] = await db.select({ name: sellerProfiles.kitchenName }).from(sellerProfiles).where(eq(sellerProfiles.userId, post.sellerId));
  const dishes = post.listingIdsJson.length ? await db.select().from(listings).where(inArray(listings.id, post.listingIdsJson)) : [];
  return { post, kitchen: k?.name ?? 'A neighbour', dishes: dishes.filter((d) => d.isActive && d.moderationStatus === 'approved') };
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const m = await load(Number((await params).id));
  if (!m) return {};
  const title = `${m.kitchen} is cooking today`;
  const description = `${m.dishes.map((d) => d.title).slice(0, 4).join(', ')}. Order from your neighbour on ${BRAND.appName}.`;
  return { title, description, openGraph: { title, description, type: 'website' }, twitter: { card: 'summary_large_image', title, description } };
}

/** The page a shared menu card links to: what the kitchen is cooking on that day. Ordering happens on the kitchen page. */
export default async function MenuPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const m = await load(id);
  if (!m) notFound();
  return (
    <div className="mx-auto max-w-lg pt-6" data-testid="menu-page">
      <div className="eyebrow">COOKING ON {m.post.forDate}</div>
      <h1 className="mt-1 text-2xl font-bold">{m.kitchen}</h1>
      {m.post.note && <p className="mt-2 text-sm text-ink-soft">{m.post.note}</p>}
      <ul className="mt-4 space-y-2" data-testid="menu-dishes">
        {m.dishes.map((d) => (
          <li key={d.id} className="flex items-center justify-between rounded-card border border-rice-line bg-white p-3 text-sm">
            <span className="font-semibold">{d.title}</span>
            <span>{formatINR(d.priceInPaise)}</span>
          </li>
        ))}
      </ul>
      <Link href={`/kitchen/${m.post.sellerId}`} className="mt-5 flex min-h-[52px] items-center justify-center rounded-xl bg-turmeric px-6 text-base font-bold text-ink shadow-card" data-testid="menu-order">Order from {m.kitchen}</Link>
      <div className="mt-3"><ShareButton text={`🍲 ${m.kitchen} is cooking today: ${m.dishes.map((d) => d.title).slice(0, 5).join(', ')}.`} /></div>
    </div>
  );
}
