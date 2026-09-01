import Link from 'next/link';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { getSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { sellerProfiles } from '@/lib/db/schema';
import { DEFAULTS } from '@/lib/config';
import { RoleNav } from '@/components/role-nav';

export const dynamic = 'force-dynamic';

export default async function SellerLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login?next=/seller');
  if (session.role !== 'seller' && session.role !== 'admin') redirect('/');

  // Pilot Hardening v2 — Phase 5 (Trust & hygiene, DECISIONS.md #73+): a soft
  // nudge, not a hard gate — an admin browsing seller pages, or a seller who
  // hasn't finished onboarding yet, can still use every tab.
  let needsKitchenPhotos = false;
  if (session.role === 'seller') {
    const db = await getDb();
    const [profile] = await db.select().from(sellerProfiles).where(eq(sellerProfiles.userId, session.uid));
    needsKitchenPhotos = (profile?.kitchenPhotosJson?.length ?? 0) < DEFAULTS.minKitchenPhotosRequired;
  }

  return (
    <>
      <RoleNav
        title="KITCHEN DASHBOARD"
        tabs={[
          { href: '/seller', label: 'Overview' },
          { href: '/seller/orders', label: 'Orders' },
          { href: '/seller/listings', label: 'My dishes' },
          { href: '/seller/fulfillment', label: 'Fulfillment' },
          { href: '/seller/earnings', label: 'Earnings' },
          { href: '/seller/reviews', label: 'Reviews' },
          { href: '/seller/compliance', label: 'FSSAI & Compliance' },
        ]}
      />
      {needsKitchenPhotos && (
        <Link
          href="/seller/onboarding"
          className="mt-4 block rounded-2xl bg-turmeric-tint px-4 py-3 text-sm font-medium text-turmeric-deep hover:bg-turmeric-tint/70"
        >
          📸 Add {DEFAULTS.minKitchenPhotosRequired} kitchen photos to build trust with buyers — finish
          your kitchen profile.
        </Link>
      )}
      <div className="pt-5">{children}</div>
    </>
  );
}
