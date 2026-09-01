import { ImageResponse } from 'next/og';
import { getListingDetail } from '@/lib/browse';
import { BRAND } from '@/lib/config';
import { formatINR } from '@/lib/money';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = `${BRAND.name} dish`;

/**
 * Pilot Hardening v2 — Phase 6 (Society-first launch mechanics, DECISIONS.md
 * #87+). See kitchen/[id]/opengraph-image.tsx's file comment for why this is
 * a branded text card rather than embedding the dish's own (external,
 * possibly-dead) photo URL.
 */
export default async function Image({ params }: { params: { id: string } }) {
  const id = Number(params.id);
  const detail = Number.isFinite(id) ? await getListingDetail(id) : null;

  const title = detail?.listing.title ?? BRAND.name;
  const kitchen = detail?.profile.kitchenName;
  const cuisine = detail?.listing.cuisine;
  const price = detail ? formatINR(detail.listing.priceInPaise) : null;
  const isVeg = detail?.listing.isVeg;

  return new ImageResponse(
    (
      <div
        style={{
          height: '100%',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: 64,
          background: 'linear-gradient(135deg, #12291A 0%, #1E4D2B 55%, #3A5D34 100%)',
          color: '#FBF6EC',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 32, fontWeight: 700 }}>
          <span>🍲</span>
          <span>{BRAND.name}</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {cuisine && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 26, color: '#E8A020', fontWeight: 600 }}>
              {isVeg !== undefined && (
                <span
                  style={{
                    display: 'flex',
                    width: 22,
                    height: 22,
                    borderRadius: 4,
                    border: `3px solid ${isVeg ? '#4CA354' : '#C63D2F'}`,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <span
                    style={{
                      display: 'flex',
                      width: 10,
                      height: 10,
                      borderRadius: 999,
                      background: isVeg ? '#4CA354' : '#C63D2F',
                    }}
                  />
                </span>
              )}
              <span>{cuisine.toUpperCase()}</span>
            </div>
          )}
          <div style={{ display: 'flex', fontSize: 64, fontWeight: 800, lineHeight: 1.1 }}>{title}</div>
          {kitchen && (
            <div style={{ display: 'flex', fontSize: 30, color: 'rgba(251,246,236,0.85)' }}>from {kitchen}</div>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', fontSize: 24, color: 'rgba(251,246,236,0.75)' }}>
            Home-cooked, within 10 km of you.
          </div>
          {price && (
            <div
              style={{
                display: 'flex',
                background: '#E8A020',
                color: '#12291A',
                borderRadius: 999,
                padding: '12px 28px',
                fontSize: 34,
                fontWeight: 800,
              }}
            >
              {price}
            </div>
          )}
        </div>
      </div>
    ),
    { ...size },
  );
}
