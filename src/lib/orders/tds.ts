import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { notify } from '@/lib/db/notify';
import { emit } from '@/lib/notify';
import { getPlatformSettings, setPlatformSetting } from '@/lib/db/platform';
import { platformConfig } from '@/lib/db/schema';
import { formatINR } from '@/lib/money';
import { fyLabel, sellerFySalesPaise } from './caps';
import { notifyAdmins } from './strikes';

/**
 * Income-tax Act 2025 Sec 393(1) Sl. 8(v) (formerly 194-O): the platform must deduct 0.1% TDS on a seller's
 * gross sales through it once they pass ₹5 lakh in a financial year, even when buyers pay sellers directly.
 * The pilot does NOT build TDS deduction, so it (1) warns at `tdsWarnPaise` and (2) pauses new orders at
 * `tdsPausePaise` until an admin decides. Each alert fires exactly once per seller per financial year.
 */
export async function checkTdsThresholds(sellerId: number, now: Date = new Date()): Promise<'none' | 'warned' | 'paused'> {
  const db = await getDb();
  const settings = await getPlatformSettings();
  const total = await sellerFySalesPaise(db, sellerId, now);
  const fy = fyLabel(now);
  const once = async (kind: 'warn' | 'pause'): Promise<boolean> => {
    const key = `tds:${kind}:${sellerId}:${fy}`;
    const [row] = await db.select().from(platformConfig).where(eq(platformConfig.key, key));
    if (row) return false;
    await setPlatformSetting(key, now.toISOString());
    return true;
  };
  if (settings.tdsPausePaise > 0 && total >= settings.tdsPausePaise) {
    if (await once('pause')) {
      await emit('listing_paused', sellerId, { reason: `Your sales this financial year reached ${formatINR(total)}. PadosiPlate will contact you about tax (TDS) before orders resume.` });
      await notifyAdmins('Kitchen reached the TDS threshold', `Kitchen #${sellerId}: FY ${fy} gross sales ${formatINR(total)}. New orders are paused pending your decision.`, `/admin/kitchens/${sellerId}`);
      return 'paused';
    }
    return 'paused';
  }
  if (settings.tdsWarnPaise > 0 && total >= settings.tdsWarnPaise) {
    if (await once('warn')) {
      await notify(sellerId, 'You are close to the tax threshold', `Your sales this financial year are ${formatINR(total)}. Above ${formatINR(settings.tdsPausePaise)}, tax (TDS) rules apply to sales through the platform.`, '/seller/earnings');
      await notifyAdmins('Kitchen approaching the TDS threshold', `Kitchen #${sellerId}: FY ${fy} gross sales ${formatINR(total)}.`, `/admin/kitchens/${sellerId}`);
      return 'warned';
    }
  }
  return 'none';
}
