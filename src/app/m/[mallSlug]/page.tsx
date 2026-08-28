import { notFound } from 'next/navigation';
import { eq, and, gt } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { malls, restaurantItems, restaurants } from '@/lib/db/schema';
import { MallClient } from './mall-client';

export const dynamic = 'force-dynamic';

export default async function MallPage({ params }: { params: { mallSlug: string } }) {
  const db = await getDb();
  const [mall] = await db.select().from(malls).where(eq(malls.slug, params.mallSlug));
  if (!mall) notFound();

  const rests = await db.select().from(restaurants).where(eq(restaurants.mallId, mall.id));
  const items = await db
    .select()
    .from(restaurantItems)
    .where(and(eq(restaurantItems.isActive, true), gt(restaurantItems.stockQty, 0)));

  return (
    <MallClient
      mall={{ name: mall.name, city: mall.city, slug: mall.slug }}
      restaurants={rests.map((r) => ({
        id: r.id,
        name: r.name,
        counterNumber: r.counterNumber,
        fssaiNumber: r.fssaiNumber,
        items: items
          .filter((i) => i.restaurantId === r.id)
          .map((i) => ({
            id: i.id,
            title: i.title,
            priceInPaise: i.priceInPaise,
            isVeg: i.isVeg,
            photoUrl: i.photoUrl,
            stockQty: i.stockQty,
          })),
      }))}
    />
  );
}
