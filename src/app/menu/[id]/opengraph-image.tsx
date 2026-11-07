import { ImageResponse } from 'next/og';
import { eq, inArray } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { listings, menuPosts, sellerProfiles } from '@/lib/db/schema';
import { BRAND } from '@/lib/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = `${BRAND.name} menu`;

/** The WhatsApp share card for one kitchen's menu of the day: a branded text card (no external photos that could 404). */
export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const db = await getDb();
  const [post] = Number.isFinite(id) ? await db.select().from(menuPosts).where(eq(menuPosts.id, id)) : [];
  const [k] = post ? await db.select({ name: sellerProfiles.kitchenName }).from(sellerProfiles).where(eq(sellerProfiles.userId, post.sellerId)) : [];
  const dishes = post && post.listingIdsJson.length ? await db.select({ title: listings.title }).from(listings).where(inArray(listings.id, post.listingIdsJson)) : [];
  const names = dishes.map((d) => d.title);
  return new ImageResponse(
    (
      <div style={{ height: '100%', width: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: 64, background: 'linear-gradient(135deg, #12291A 0%, #1E4D2B 55%, #3A5D34 100%)', color: '#FBF6EC', fontFamily: 'sans-serif' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 32, fontWeight: 700 }}>
          <span>🍲</span>
          <span>{BRAND.name}</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ display: 'flex', fontSize: 26, color: '#E8A020', fontWeight: 600 }}>COOKING TODAY{post ? ` · ${post.forDate}` : ''}</div>
          <div style={{ display: 'flex', fontSize: 66, fontWeight: 800, lineHeight: 1.1 }}>{k?.name ?? 'A neighbour'}</div>
          <div style={{ display: 'flex', fontSize: 34, color: 'rgba(251,246,236,0.9)' }}>{names.slice(0, 4).join('  ·  ')}{names.length > 4 ? `  +${names.length - 4} more` : ''}</div>
        </div>
        <div style={{ display: 'flex', fontSize: 24, color: 'rgba(251,246,236,0.75)' }}>Home-cooked by a neighbour. Pay at your door.</div>
      </div>
    ),
    { ...size },
  );
}
