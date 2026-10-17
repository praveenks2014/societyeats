import path from 'node:path';
import { expect, test } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import * as schema from '@/lib/db/schema';

/**
 * Proves the SQL-side Haversine radius filter in browseListings() (see
 * src/lib/browse.ts) draws the line exactly at the configured radius
 * (10 km by default): a seller 9.9 km away is included, one 10.1 km away
 * is excluded. Runs against a real Postgres-compatible engine (embedded
 * PGlite, in-memory, discarded when the process exits) instead of just
 * asserting on the JS haversineKm() formula, because the thing being
 * verified is the SQL translation + WHERE-clause wiring, not the math
 * (geo.ts's own formula was already correct before this phase).
 *
 * Run with: npm test
 */

const EARTH_RADIUS_KM = 6371;

/**
 * Moving due north only (same lng) from a fixed origin, the haversine
 * formula reduces to distance = EARTH_RADIUS_KM * dLatRadians exactly
 * (asin(sin(x)) === x in this range) — so this inversion produces a
 * seller at *exactly* the target distance, not an approximation.
 */
function latDegreesForKmNorth(km: number): number {
  return (km / EARTH_RADIUS_KM) * (180 / Math.PI);
}

async function buildIsolatedTestDb() {
  const client = new PGlite(); // in-memory — no files touched, nothing to clean up
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'drizzle') });
  return db;
}

async function seedSeller(
  db: Awaited<ReturnType<typeof buildIsolatedTestDb>>,
  phone: string,
  lat: number,
  lng: number,
  listingTitle: string,
) {
  const [user] = await db
    .insert(schema.users)
    .values({ phone, name: `Test seller ${phone}`, passwordHash: 'x', role: 'seller', lat, lng })
    .returning();
  await db.insert(schema.sellerProfiles).values({
    userId: user.id,
    kitchenName: `Kitchen ${phone}`,
    isApproved: true,
    fssaiStatus: 'verified',
  });
  await db.insert(schema.listings).values({
    sellerId: user.id,
    title: listingTitle,
    priceInPaise: 10000,
    cuisine: 'Test',
    availableQty: 5,
    isActive: true,
  });
}

test('browseListings: SQL radius filter includes 9.9 km and excludes 10.1 km', async () => {
  const db = await buildIsolatedTestDb();
  // Point the app's lazy DB singleton (src/lib/db/index.ts) at this isolated,
  // in-memory database before browseListings() — or anything it transitively
  // calls — ever invokes getDb() itself.
  (globalThis as { __padosiDb?: unknown }).__padosiDb = Promise.resolve(db);

  const { browseListings } = await import('@/lib/browse');

  const originLat = 0;
  const originLng = 0;
  const nearLat = originLat + latDegreesForKmNorth(9.9);
  const farLat = originLat + latDegreesForKmNorth(10.1);

  await seedSeller(db, '9990000001', nearLat, originLng, 'Near dish (9.9km)');
  await seedSeller(db, '9990000002', farLat, originLng, 'Far dish (10.1km)');

  const result = await browseListings({ lat: originLat, lng: originLng });
  const titles = result.listings.map((l) => l.title);

  expect(titles).toContain('Near dish (9.9km)');
  expect(titles).not.toContain('Far dish (10.1km)');

  const near = result.listings.find((l) => l.title === 'Near dish (9.9km)');
  expect(near).toBeDefined();
  expect(Math.abs((near!.distanceKm ?? 0) - 9.9)).toBeLessThan(0.01);
});
