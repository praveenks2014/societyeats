import { ImageResponse } from 'next/og';
import { getKitchenProfile } from '@/lib/browse';
import { BRAND } from '@/lib/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = `${BRAND.name} kitchen`;

/**
 * Pilot Hardening v2 — Phase 6 (Society-first launch mechanics, DECISIONS.md
 * #87+). A branded, text-only card (no remote photo fetch) so a WhatsApp/
 * social preview never depends on a third-party image URL still resolving —
 * same "never let a dead external URL break the experience" instinct as
 * FoodImage's fallback (DECISIONS.md #22), just applied at generation time
 * instead of render time.
 */
export default async function Image({ params }: { params: { id: string } }) {
  const id = Number(params.id);
  const kitchen = Number.isFinite(id) ? await getKitchenProfile(id) : null;

  const name = kitchen?.profile.kitchenName ?? BRAND.name;
  const society = kitchen?.society?.name;
  const rating = kitchen?.profile.rating ?? 0;
  const badgeTier = kitchen?.badgeTier;

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
          {society && (
            <div style={{ display: 'flex', fontSize: 26, color: '#E8A020', fontWeight: 600 }}>
              HOME KITCHEN · {society.toUpperCase()}
            </div>
          )}
          <div style={{ display: 'flex', fontSize: 68, fontWeight: 800, lineHeight: 1.1 }}>{name}</div>
          <div style={{ display: 'flex', gap: 14 }}>
            {rating > 0 && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  background: '#1E4D2B',
                  border: '2px solid #E8A020',
                  borderRadius: 999,
                  padding: '10px 22px',
                  fontSize: 28,
                  fontWeight: 700,
                }}
              >
                ★ {rating.toFixed(1)}
              </div>
            )}
            {badgeTier && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  background: '#E8A020',
                  color: '#12291A',
                  borderRadius: 999,
                  padding: '10px 22px',
                  fontSize: 28,
                  fontWeight: 700,
                }}
              >
                🏅 {badgeTier}+ orders cooked
              </div>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', fontSize: 24, color: 'rgba(251,246,236,0.75)' }}>
          Home-cooked food from your neighbourhood, within 10 km.
        </div>
      </div>
    ),
    { ...size },
  );
}
