import { eq } from 'drizzle-orm';
import { api, ApiError, ok } from '@/lib/api';
import { getDb } from '@/lib/db';
import { societies, users } from '@/lib/db/schema';
import { getPlatformSettings } from '@/lib/db/platform';
import { getBestQuote } from '@/lib/delivery/orchestrator';
import { haversineKm } from '@/lib/geo';

export const dynamic = 'force-dynamic';

/** Pre-checkout bill preview: delivery quote + platform fee for a seller/drop pair. */
export const GET = api(async (req) => {
  const sp = req.nextUrl.searchParams;
  const sellerId = Number(sp.get('sellerId'));
  const lat = Number(sp.get('lat'));
  const lng = Number(sp.get('lng'));
  if (!sellerId || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new ApiError(400, 'sellerId, lat, lng required');
  }
  const db = await getDb();
  const settings = await getPlatformSettings();
  const [seller] = await db.select().from(users).where(eq(users.id, sellerId));
  if (!seller) throw new ApiError(404, 'Kitchen not found');
  let point = seller.lat != null && seller.lng != null ? { lat: seller.lat, lng: seller.lng } : null;
  if (!point && seller.societyId) {
    const [soc] = await db.select().from(societies).where(eq(societies.id, seller.societyId));
    if (soc) point = { lat: soc.lat, lng: soc.lng };
  }
  if (!point) throw new ApiError(400, 'Kitchen location unavailable');

  const distanceKm = haversineKm({ lat, lng }, point);
  if (distanceKm > settings.radiusKm) {
    return ok({ withinRange: false, distanceKm, radiusKm: settings.radiusKm });
  }
  const quote = await getBestQuote(point, { lat, lng });
  return ok({
    withinRange: true,
    distanceKm,
    deliveryFeeInPaise: quote.amountInPaise,
    etaMins: quote.etaMins,
    platformFeePaise: settings.platformFeePaise,
    commissionHomePct: settings.commissionHomePct,
  });
});
