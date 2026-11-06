import { api, ok } from '@/lib/api';
import { DISCLAIMER_DEFAULTS, DISCLAIMER_IDS } from '@/lib/disclaimers/defs';
import { listDisclaimers } from '@/lib/disclaimers';

export const dynamic = 'force-dynamic';

/** Public: current text of every disclaimer (for client components). */
export const GET = api(async () => {
  const rows = await listDisclaimers().catch(() => []);
  const map: Record<string, string> = Object.fromEntries(DISCLAIMER_IDS.map((id) => [id, DISCLAIMER_DEFAULTS[id]]));
  for (const r of rows) map[r.id] = r.text;
  return ok({ disclaimers: map });
});
