import { and, asc, eq } from 'drizzle-orm';
import type { Db } from '@/lib/db';
import { getDb } from '@/lib/db';
import { fssaiWalkthroughSteps } from '@/lib/db/schema';
import { PERSISTENT_NOTICE } from './assistant';

export const LANGS = [
  { code: 'en', label: 'English' },
  { code: 'te', label: 'తెలుగు (Telugu)' },
  { code: 'hi', label: 'हिन्दी (Hindi)' },
] as const;

const EN_STEPS: { title: string; body: string; tip: string }[] = [
  { title: 'Open the official portal', body: 'Go to foscos.fssai.gov.in and click “Login / Sign up” as a Food Business Operator. Create your account with your own mobile number and email.', tip: 'Keep your phone with you — FoSCoS sends its own OTP to you. PadosiPlate never needs your FoSCoS password or OTP.' },
  { title: 'Start a new application', body: 'Choose “Apply for Registration” and then “Basic Registration” (Form A) for a petty food business / home kitchen.', tip: 'If the portal tells you a licence is needed instead, come back and enter that licence number under “Already have a licence?”.' },
  { title: 'Fill in Form A', body: 'Use the sections in your filing pack in order — applicant details, premises, food categories, duration, source of water.', tip: 'Copy-paste straight from the pack so the spellings match your ID proof.' },
  { title: 'Upload your documents', body: 'Upload your photo ID (Aadhaar only if the first 8 digits are masked), address proof and the other documents listed in your pack.', tip: 'Photos should be clear and show all four corners of the document.' },
  { title: 'Pay the government fee', body: 'Pay the registration fee shown for the number of years you chose. This is paid to FSSAI directly on the portal — never to PadosiPlate.', tip: 'Save the payment receipt.' },
  { title: 'Submit and note the reference number', body: 'Submit the application and note the reference / application number FoSCoS shows you.', tip: 'Take a screenshot of the acknowledgement.' },
  { title: 'Come back and enter your reference number', body: 'Enter the reference number on your PadosiPlate summary page so we can remind you to check progress. Basic Registration is deemed granted if there is no response within 7 days — but always check the portal.', tip: PERSISTENT_NOTICE },
];

/** Seeds English steps plus Telugu / Hindi placeholders (editable in admin). Idempotent. */
export async function seedFssaiContent(db: Db): Promise<void> {
  const existing = await db.select({ id: fssaiWalkthroughSteps.id }).from(fssaiWalkthroughSteps).limit(1);
  if (existing.length) return;
  const rows = EN_STEPS.map((s, i) => ({ lang: 'en', sort: i, title: s.title, body: s.body, tip: s.tip }));
  for (const lang of ['te', 'hi'] as const) {
    const label = lang === 'te' ? 'Telugu' : 'Hindi';
    EN_STEPS.forEach((s, i) => rows.push({ lang, sort: i, title: `[${label} translation pending] ${s.title}`, body: `[${label} translation pending] ${s.body}`, tip: s.tip }));
  }
  await db.insert(fssaiWalkthroughSteps).values(rows);
}

export async function getWalkthrough(lang: string) {
  const db = await getDb();
  const rows = await db.select().from(fssaiWalkthroughSteps).where(eq(fssaiWalkthroughSteps.lang, lang)).orderBy(asc(fssaiWalkthroughSteps.sort), asc(fssaiWalkthroughSteps.id));
  if (rows.length) return rows;
  // fall back to English if a language has no rows
  return db.select().from(fssaiWalkthroughSteps).where(and(eq(fssaiWalkthroughSteps.lang, 'en'))).orderBy(asc(fssaiWalkthroughSteps.sort), asc(fssaiWalkthroughSteps.id));
}
