import { api, ok } from '@/lib/api';
import { getPlatformSettings } from '@/lib/db/platform';
import { feeConfigFromSettings } from '@/lib/money';

export const dynamic = 'force-dynamic';

/** Public: the fee rules buyers are charged under (they are shown upfront on every dish, cart and checkout). */
export const GET = api(async () => {
  const s = await getPlatformSettings();
  return ok({ feeConfig: feeConfigFromSettings(s) });
});
