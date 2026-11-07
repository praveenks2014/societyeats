import { api, ApiError, ok } from '@/lib/api';
import { isPilotMember } from '@/lib/access';
import { getSession } from '@/lib/auth';
import { browseListings, comingSoonKitchens } from '@/lib/browse';
import { getPlatformSettings } from '@/lib/db/platform';
import { sponsoredFor } from '@/lib/featured';

export const dynamic = 'force-dynamic';

/** Pilot v2: invite-only. Visitors and non-members get a 403 `invite_only` (the page shows the request-access form). */
export const GET = api(async (req) => {
  const sp = req.nextUrl.searchParams;
  const lat = sp.get('lat');
  const lng = sp.get('lng');
  const session = await getSession();
  const settings = await getPlatformSettings();
  if (settings.pilotSocietiesOnly && (!session || !(await isPilotMember(session.uid)))) {
    throw new ApiError(403, 'PadosiPlate is invite-only during the pilot', 'invite_only');
  }
  const result = await browseListings({
    societyId: sp.get('scope') === 'society' ? (session?.societyId ?? undefined) : undefined,
    homeSocietyId: session?.societyId ?? undefined,
    lat: lat ? Number(lat) : undefined,
    lng: lng ? Number(lng) : undefined,
    veg: sp.get('veg') === '1',
    cuisine: sp.get('cuisine') || undefined,
    q: sp.get('q') || undefined,
  });
  return ok({ ...result, comingSoon: await comingSoonKitchens(session?.societyId), sponsored: await sponsoredFor(session?.societyId) });
});
