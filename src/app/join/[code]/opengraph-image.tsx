import { ImageResponse } from 'next/og';
import { BRAND } from '@/config/brand';
import { societyForInvite } from '@/lib/join';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = `Join ${BRAND.appName}`;

/** Text-only branded card so a WhatsApp preview never depends on an external image. */
export default async function Image({ params }: { params: Promise<{ code: string }> }) {
  const r = await societyForInvite((await params).code);
  const name = r?.society.name ?? BRAND.appName;
  return new ImageResponse(
    (
      <div style={{ height: '100%', width: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: 64, background: 'linear-gradient(135deg, #12291A 0%, #1E4D2B 55%, #3A5D34 100%)', color: '#FBF6EC', fontFamily: 'sans-serif' }}>
        <div style={{ display: 'flex', fontSize: 34, fontWeight: 700 }}>🍛 {BRAND.appName}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', fontSize: 28, color: '#E8A020', fontWeight: 600 }}>NOW COOKING IN</div>
          <div style={{ display: 'flex', fontSize: 72, fontWeight: 800, lineHeight: 1.1 }}>{name}</div>
          {r && r.liveKitchens > 0 && <div style={{ display: 'flex', fontSize: 30 }}>{r.liveKitchens} neighbour kitchen{r.liveKitchens === 1 ? '' : 's'} live</div>}
        </div>
        <div style={{ display: 'flex', fontSize: 26, color: 'rgba(251,246,236,0.8)' }}>{BRAND.tagline}</div>
      </div>
    ),
    { ...size },
  );
}
