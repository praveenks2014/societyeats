import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getListingDetail } from '@/lib/browse';
import { getPlatformSettings } from '@/lib/db/platform';
import { DEFAULTS } from '@/lib/config';
import { DishDetail } from './dish-detail';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const id = Number(params.id);
  if (!Number.isFinite(id)) return {};
  const detail = await getListingDetail(id);
  if (!detail) return {};
  const title = `${detail.listing.title} — ${detail.profile.kitchenName}`;
  const description =
    detail.listing.description ||
    `${detail.listing.cuisine} from ${detail.profile.kitchenName}${detail.society ? `, ${detail.society.name}` : ''} — order on PadosiPlate.`;
  return {
    title,
    description,
    openGraph: { title, description, type: 'website' },
    twitter: { card: 'summary_large_image', title, description },
  };
}

export default async function DishPage({ params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (!Number.isFinite(id)) notFound();
  const detail = await getListingDetail(id);
  if (!detail) notFound();
  const settings = await getPlatformSettings();

  const sellerPoint =
    detail.seller.lat != null && detail.seller.lng != null
      ? { lat: detail.seller.lat, lng: detail.seller.lng }
      : detail.society
        ? { lat: detail.society.lat, lng: detail.society.lng }
        : null;

  return (
    <DishDetail
      listing={{
        id: detail.listing.id,
        title: detail.listing.title,
        description: detail.listing.description,
        priceInPaise: detail.listing.priceInPaise,
        isVeg: detail.listing.isVeg,
        cuisine: detail.listing.cuisine,
        photoUrl: detail.listing.photoUrl,
        prepTimeMins: detail.listing.prepTimeMins,
        availableQty: detail.listing.availableQty,
        isActive: detail.listing.isActive,
        slotsJson: detail.listing.slotsJson,
      }}
      seller={{
        id: detail.listing.sellerId,
        kitchenName: detail.profile.kitchenName,
        bio: detail.profile.bio,
        rating: detail.profile.rating,
        ratingCount: detail.profile.ratingCount,
        fssaiStatus: detail.profile.fssaiStatus,
        fssaiNumber: detail.profile.fssaiNumber,
        eligibleFoscosRef: detail.eligibleFoscosRef,
        vegOnly: detail.profile.vegOnly,
        societyName: detail.society?.name ?? null,
        kitchenPhotos: detail.profile.kitchenPhotosJson ?? [],
        kitchenPhotosVerified:
          (detail.profile.kitchenPhotosJson?.length ?? 0) >= DEFAULTS.minKitchenPhotosRequired,
        kitchenVideoUrl: detail.profile.kitchenVideoUrl,
        cookingSinceYear: detail.profile.cookingSinceYear,
        cuisines: detail.profile.cuisinesJson ?? [],
        orderedByCount: detail.orderedByCount,
        badgeTier: detail.badgeTier,
      }}
      sellerPoint={sellerPoint}
      radiusKm={settings.radiusKm}
      reviews={detail.sellerReviews.map((r) => ({
        id: r.review.id,
        rating: r.review.rating,
        text: r.review.text,
        buyerName: r.buyer.name,
        createdAt: r.review.createdAt.toISOString(),
        sellerReplyText: r.review.sellerReplyText,
      }))}
      otherDishes={detail.otherDishes.map((d) => ({
        id: d.id,
        title: d.title,
        priceInPaise: d.priceInPaise,
        isVeg: d.isVeg,
        photoUrl: d.photoUrl,
        availableQty: d.availableQty,
      }))}
      slotSoldOut={detail.slotSoldOut}
    />
  );
}
