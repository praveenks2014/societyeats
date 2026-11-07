import { desc, eq, inArray } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { getPlatformSettings } from '@/lib/db/platform';
import { consents, fssaiApplications, listings, sellerProfiles, societies, societyMemberships, upiVerifications, users } from '@/lib/db/schema';
import { AGREEMENT_VERSION, HYGIENE_ITEMS, MIN_KITCHEN_PHOTOS } from '@/lib/kitchen/onboarding';
import { fssaiTierInfo } from '@/lib/fssai/tier';

export type CheckStatus = 'pass' | 'flag' | 'fail';
export type Check = { key: string; label: string; status: CheckStatus; detail: string };

/** Message templates an admin can send with “request changes” (still editable before sending). */
export const CHANGE_TEMPLATES: { key: string; label: string; text: string }[] = [
  { key: 'photos', label: 'Better kitchen photos', text: 'Please upload clear photos of your cooking area and utensils (at least 2). The ones we have are blurred or too dark.' },
  { key: 'pan', label: 'PAN name does not match', text: 'The name on your PAN does not match the name on your UPI ID. Please check both, or upload proof that they are the same person.' },
  { key: 'upi', label: 'UPI check needed', text: 'Please complete the ₹1 UPI ownership check from the UPI ID you entered, so buyers pay the right person.' },
  { key: 'fssai', label: 'FSSAI details', text: 'Please finish the FSSAI step: file on FoSCoS and add your reference number (or certificate) so we can show your status.' },
  { key: 'dishes', label: 'Dish details', text: 'Please add ingredients and allergens to each dish and make sure the photos show the real food.' },
  { key: 'hygiene', label: 'Hygiene declaration', text: 'Please complete every item of the food-safety declaration.' },
];

export type Checklist = {
  sellerId: number;
  kitchenName: string;
  ownerName: string;
  society: string | null;
  state: string;
  submittedAt: Date | null;
  ageHours: number | null;
  targetHours: number;
  overdue: boolean;
  checks: Check[];
  blockingFails: number;
  flags: number;
};

const PAN_RE = /^[A-Z]{5}\d{4}[A-Z]$/;

/** Pass/flag/fail for everything an admin should look at before approving a kitchen. A flag needs a human look; a fail blocks approval until fixed. */
export async function kitchenChecklist(sellerId: number, now: Date = new Date()): Promise<Checklist | null> {
  const db = await getDb();
  const settings = await getPlatformSettings();
  const [p] = await db.select().from(sellerProfiles).where(eq(sellerProfiles.userId, sellerId));
  const [u] = await db.select().from(users).where(eq(users.id, sellerId));
  if (!p || !u) return null;
  const [member] = await db.select().from(societyMemberships).where(eq(societyMemberships.userId, sellerId)).limit(1);
  const [app] = await db.select().from(fssaiApplications).where(eq(fssaiApplications.sellerId, sellerId)).orderBy(desc(fssaiApplications.createdAt)).limit(1);
  const [verif] = await db.select().from(upiVerifications).where(eq(upiVerifications.sellerId, sellerId)).orderBy(desc(upiVerifications.createdAt)).limit(1);
  const dishes = await db.select({ status: listings.moderationStatus }).from(listings).where(eq(listings.sellerId, sellerId));
  const latestTerms = await db.select().from(consents).where(eq(consents.userId, sellerId)).orderBy(desc(consents.acceptedAt));
  const [society] = u.societyId ? await db.select({ name: societies.name }).from(societies).where(eq(societies.id, u.societyId)) : [];

  const checks: Check[] = [];
  const add = (key: string, label: string, status: CheckStatus, detail: string) => checks.push({ key, label, status, detail });

  add('membership', 'Society membership', member?.status === 'approved' ? 'pass' : member ? 'flag' : 'fail', member ? `Membership ${member.status}` : 'Not a member of any pilot society');
  add('email', 'Email verified', u.emailVerifiedAt ? 'pass' : 'fail', u.emailVerifiedAt ? u.email ?? 'verified' : 'Email is not verified');

  const panOk = !!p.panMasked && PAN_RE.test(`${p.panMasked.slice(0, 5)}0000${p.panMasked.slice(-1)}`.replace(/\*/g, '0'));
  const panScore = p.panVerifyJson?.nameMatchScore;
  add('pan', 'PAN (format and name)', !p.panMasked ? 'fail' : !panOk || p.panVerifyJson?.status === 'invalid' ? 'fail' : p.panVerifyJson?.status === 'name_mismatch' || (panScore != null && panScore < settings.upiNameMatchMinScore) ? 'flag' : 'pass', p.panMasked ? `${p.panMasked} · name on card: ${p.panNameOnCard ?? '—'}${panScore != null ? ` · match ${panScore}` : ''}` : 'No PAN on file');

  const upiScore = p.upiNameMatchScore;
  const upiStatus = p.upiVerifyStatus;
  add(
    'upi',
    '₹1 UPI ownership check',
    upiStatus === 'verified' ? (upiScore != null && upiScore < settings.upiNameMatchMinScore ? 'flag' : 'pass') : upiStatus === 'needs_manual_review' || upiStatus === 'mismatch' ? 'flag' : 'fail',
    `${p.upiVpa ?? 'no UPI ID'} · ${upiStatus}${p.upiVerifiedName ? ` · registered name ${p.upiVerifiedName}` : ''}${upiScore != null ? ` · name match ${upiScore}/100 (min ${settings.upiNameMatchMinScore})` : ''}${verif ? ` · provider ${verif.provider}${verif.evidenceFileKey ? ' · screenshot attached' : ''}` : ''}`,
  );

  const tier = fssaiTierInfo(p, app ?? null, { deemedDays: settings.fssaiDeemedGrantDaysRegistration, provisionalMaxDays: settings.provisionalMaxDays, now });
  add('fssai', 'FSSAI', tier.tier === 'verified' ? 'pass' : tier.tier === 'provisional' || tier.tier === 'applied' ? 'flag' : 'fail', `Tier: ${tier.tier} · ${tier.reason}${app?.documentsJson?.length ? ` · ${app.documentsJson.length} document(s)` : ''}`);

  const photos = p.kitchenPhotosJson?.length ?? 0;
  add('photos', 'Kitchen photos', photos >= MIN_KITCHEN_PHOTOS ? 'pass' : 'fail', `${photos} photo(s), at least ${MIN_KITCHEN_PHOTOS} needed`);
  const hygiene = p.hygieneDeclarationJson ?? {};
  const missing = HYGIENE_ITEMS.filter((i) => !hygiene[i.key]).length;
  add('hygiene', 'Food-safety declaration', missing === 0 ? 'pass' : 'fail', missing === 0 ? 'All items declared' : `${missing} item(s) not declared`);
  const terms = latestTerms.find((c) => c.kind === 'kitchen_terms');
  add('terms', 'Kitchen Terms accepted', p.agreementVersion === AGREEMENT_VERSION ? 'pass' : 'fail', terms ? `Version ${p.agreementVersion ?? '—'} on ${terms.acceptedAt.toISOString().slice(0, 10)}` : p.agreementVersion ? `Version ${p.agreementVersion} (current is ${AGREEMENT_VERSION})` : 'Not accepted');
  const pending = dishes.filter((d) => d.status === 'pending').length;
  add('dishes', 'Dishes', dishes.length === 0 ? 'fail' : pending > 0 ? 'flag' : 'pass', dishes.length === 0 ? 'No dishes yet' : `${dishes.length} dish(es), ${pending} waiting for moderation`);

  const submittedAt = p.listingSubmittedAt ?? null;
  const ageHours = submittedAt ? Math.floor((now.getTime() - submittedAt.getTime()) / 3_600_000) : null;
  const targetHours = settings.onboardingTargetHours;
  return {
    sellerId,
    kitchenName: p.kitchenName,
    ownerName: u.name,
    society: society?.name ?? null,
    state: p.listingState,
    submittedAt,
    ageHours,
    targetHours,
    overdue: ageHours != null && ageHours > targetHours && ['submitted', 'changes_requested'].includes(p.listingState),
    checks,
    blockingFails: checks.filter((c) => c.status === 'fail').length,
    flags: checks.filter((c) => c.status === 'flag').length,
  };
}

export async function applicationsQueue(now: Date = new Date()): Promise<Checklist[]> {
  const db = await getDb();
  const rows = await db.select({ id: sellerProfiles.userId }).from(sellerProfiles).where(inArray(sellerProfiles.listingState, ['submitted', 'changes_requested']));
  const out: Checklist[] = [];
  for (const r of rows) {
    const c = await kitchenChecklist(r.id, now);
    if (c) out.push(c);
  }
  // oldest submission first: the one closest to (or past) the 48-hour target leads
  return out.sort((a, b) => (a.submittedAt?.getTime() ?? 0) - (b.submittedAt?.getTime() ?? 0));
}
