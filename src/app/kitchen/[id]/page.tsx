import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getKitchenProfile } from '@/lib/browse';
import { KitchenProfile } from './kitchen-client';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const id = Number((await params).id);
  if (!Number.isFinite(id)) return {};
  const kitchen = await getKitchenProfile(id);
  if (!kitchen) return {};
  const title = kitchen.profile.kitchenName;
  const description =
    kitchen.profile.bio ||
    `Home-cooked food from ${kitchen.profile.kitchenName}${kitchen.society ? `, ${kitchen.society.name}` : ''} — order on PadosiPlate.`;
  return {
    title,
    description,
    openGraph: { title, description, type: 'profile' },
    twitter: { card: 'summary_large_image', title, description },
  };
}

export default async function KitchenPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isFinite(id)) notFound();
  const kitchen = await getKitchenProfile(id);
  if (!kitchen) notFound();

  return (
    <KitchenProfile
      seller={{
        id: kitchen.seller.id,
        kitchenName: kitchen.profile.kitchenName,
        bio: kitchen.profile.bio,
        rating: kitchen.profile.rating,
        ratingCount: kitchen.profile.ratingCount,
        fssaiStatus: kitchen.profile.fssaiStatus,
        fssaiNumber: kitchen.profile.fssaiNumber,
        eligibleFoscosRef: kitchen.eligibleFoscosRef,
        vegOnly: kitchen.profile.vegOnly,
        societyName: kitchen.society?.name ?? null,
        kitchenPhotos: kitchen.profile.kitchenPhotosJson ?? [],
        kitchenVideoUrl: kitchen.profile.kitchenVideoUrl,
        cookingSinceYear: kitchen.profile.cookingSinceYear,
        cuisines: kitchen.profile.cuisinesJson ?? [],
        orderedByCount: kitchen.orderedByCount,
        completedOrderCount: kitchen.completedOrderCount,
        badgeTier: kitchen.badgeTier,
        isFeatured: kitchen.isFeatured,
      }}
      listings={kitchen.activeListings.map((l) => ({
        id: l.id,
        title: l.title,
        priceInPaise: l.priceInPaise,
        isVeg: l.isVeg,
        photoUrl: l.photoUrl,
        availableQty: l.availableQty,
      }))}
      reviews={kitchen.sellerReviews.map((r) => ({
        id: r.review.id,
        rating: r.review.rating,
        text: r.review.text,
        buyerName: r.buyer.name,
        createdAt: r.review.createdAt.toISOString(),
        sellerReplyText: r.review.sellerReplyText,
      }))}
    />
  );
}
