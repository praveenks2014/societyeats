import { api, ok } from '@/lib/api';
import { getPlatformSettings } from '@/lib/db/platform';
import { vapidConfigured, vapidPublicKey } from '@/lib/notify/adapters';

export const dynamic = 'force-dynamic';

/** Public: whether web push is available and the public VAPID key the browser needs to subscribe. */
export const GET = api(async () => {
  const s = await getPlatformSettings();
  return ok({ enabled: s.pushEnabled && vapidConfigured(), publicKey: s.pushEnabled && vapidConfigured() ? vapidPublicKey() : null });
});
