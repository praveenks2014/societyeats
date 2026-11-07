import { api, ok } from '@/lib/api';
import { sellerFssai } from '@/lib/fssai/seller-tier';

export const dynamic = 'force-dynamic';

/** Public: the buyer-facing FSSAI statement for a kitchen (label only, no documents). */
export const GET = api<{ params: { sellerId: string } }>(async (_req, { params }) => {
  const id = Number(params.sellerId);
  if (!Number.isInteger(id)) return ok({ label: null, tier: 'none' });
  const f = await sellerFssai(id);
  return ok({ label: f.label, tier: f.tier });
});
