import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { platformConfig } from '@/lib/db/schema';
import { DEFAULTS } from '@/lib/config';

export type PlatformSettings = {
  commissionHomePct: number;
  commissionMallPct: number;
  platformFeePaise: number;
  radiusKm: number;
  // Pilot Hardening v2 — fulfillment pivot (DECISIONS.md #37+).
  platformDeliveryEnabled: boolean;
  platformDeliveryFeeInPaise: number;
  platformDeliveryMinOrderPaise: number;
  // Pilot Hardening v2 — Phase 4 (Compliance center refinements, DECISIONS.md #62+).
  fssaiSponsorshipCapPerCohort: number;
  platformFssaiCentralLicenseNo: string;
  // Pilot Hardening v2 — Phase 6 (Society-first launch mechanics, DECISIONS.md #87+).
  referralCreditPaise: number;
  referralCreditCapPerUser: number;
  featuredSellerId: string;
  // Pilot Hardening v2 — Phase 7 (Pilot metrics dashboard, DECISIONS.md #99+).
  killWeek8PenetrationPct: number;
  killWeek8RetentionPct: number;
  killWeek14PenetrationPct: number;
  killWeek14RetentionPct: number;
  // Pilot Hardening v2 — Phase 8 (DECISIONS.md #112+).
  mallModeEnabled: boolean;
};

/** Admin-editable settings stored in platform_config, defaults from config.ts. */
export async function getPlatformSettings(): Promise<PlatformSettings> {
  const db = await getDb();
  const rows = await db.select().from(platformConfig);
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const num = (key: string, fallback: number) => {
    const v = map[key];
    const parsed = v === undefined ? NaN : Number(v);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const bool = (key: string, fallback: boolean) => {
    const v = map[key];
    return v === undefined ? fallback : v === 'true';
  };
  const str = (key: string, fallback: string) => {
    const v = map[key];
    return v === undefined ? fallback : v;
  };
  return {
    commissionHomePct: num('commissionHomePct', DEFAULTS.commissionHomePct),
    commissionMallPct: num('commissionMallPct', DEFAULTS.commissionMallPct),
    platformFeePaise: num('platformFeePaise', DEFAULTS.platformFeePaise),
    radiusKm: num('radiusKm', DEFAULTS.radiusKm),
    platformDeliveryEnabled: bool('platformDeliveryEnabled', DEFAULTS.platformDeliveryEnabled),
    platformDeliveryFeeInPaise: num('platformDeliveryFeeInPaise', DEFAULTS.platformDeliveryFeeInPaise),
    platformDeliveryMinOrderPaise: num(
      'platformDeliveryMinOrderPaise',
      DEFAULTS.platformDeliveryMinOrderPaise,
    ),
    fssaiSponsorshipCapPerCohort: num(
      'fssaiSponsorshipCapPerCohort',
      DEFAULTS.fssaiSponsorshipCapPerCohort,
    ),
    platformFssaiCentralLicenseNo: str(
      'platformFssaiCentralLicenseNo',
      DEFAULTS.platformFssaiCentralLicenseNo,
    ),
    referralCreditPaise: num('referralCreditPaise', DEFAULTS.referralCreditPaise),
    referralCreditCapPerUser: num('referralCreditCapPerUser', DEFAULTS.referralCreditCapPerUser),
    featuredSellerId: str('featuredSellerId', DEFAULTS.featuredSellerId),
    killWeek8PenetrationPct: num('killWeek8PenetrationPct', DEFAULTS.killWeek8PenetrationPct),
    killWeek8RetentionPct: num('killWeek8RetentionPct', DEFAULTS.killWeek8RetentionPct),
    killWeek14PenetrationPct: num('killWeek14PenetrationPct', DEFAULTS.killWeek14PenetrationPct),
    killWeek14RetentionPct: num('killWeek14RetentionPct', DEFAULTS.killWeek14RetentionPct),
    mallModeEnabled: bool('mallModeEnabled', DEFAULTS.mallModeEnabled),
  };
}

export async function setPlatformSetting(key: string, value: string): Promise<void> {
  const db = await getDb();
  const existing = await db
    .select()
    .from(platformConfig)
    .where(eq(platformConfig.key, key));
  if (existing.length > 0) {
    await db.update(platformConfig).set({ value }).where(eq(platformConfig.key, key));
  } else {
    await db.insert(platformConfig).values({ key, value });
  }
}
