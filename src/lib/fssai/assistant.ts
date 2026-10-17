/**
 * FSSAI Basic Registration assistant (Form A). Pure helpers — no DB, no
 * network — so the rules are unit-tested and shared by the wizard, the API
 * and the filing pack. PadosiPlate helps sellers PREPARE; they submit the
 * application themselves on foscos.fssai.gov.in and pay government fees
 * directly to FSSAI. We never ask for or store FoSCoS passwords/OTPs.
 */
export type SalesBand = 'under_12l' | '12l_to_20cr' | 'above_20cr';
export type Eligibility = { sales: SalesBand; homeKitchen: boolean; onlyTelangana: boolean };

export type EligibilityResult =
  | { route: 'form_a'; title: string; message: string }
  | { route: 'licence'; kind: 'state' | 'central'; title: string; message: string };

export const SALES_LABELS: Record<SalesBand, string> = {
  under_12l: 'Under ₹12 lakh a year',
  '12l_to_20cr': '₹12 lakh – ₹20 crore a year',
  above_20cr: 'Above ₹20 crore a year',
};

/** Under ₹12 lakh + a home kitchen selling only within Telangana → Basic Registration (Form A); everything else needs a licence. */
export function checkEligibility(e: Eligibility): EligibilityResult {
  if (e.sales === 'under_12l' && e.homeKitchen && e.onlyTelangana) {
    return { route: 'form_a', title: 'FSSAI Basic Registration (Form A)', message: 'Good news — a home kitchen with sales under ₹12 lakh selling within Telangana can apply for Basic Registration using Form A. We’ll prepare everything for you to file.' };
  }
  const central = e.sales === 'above_20cr' || !e.onlyTelangana;
  const why: string[] = [];
  if (e.sales !== 'under_12l') why.push(`annual food sales of ${SALES_LABELS[e.sales].toLowerCase()}`);
  if (!e.homeKitchen) why.push('operating outside a home kitchen');
  if (!e.onlyTelangana) why.push('selling beyond Telangana');
  return {
    route: 'licence',
    kind: central ? 'central' : 'state',
    title: central ? 'You need a Central FSSAI licence' : 'You need a State FSSAI licence',
    message: `Because of ${why.join(' and ')}, Basic Registration (Form A) is not the right form. You need a ${central ? 'Central' : 'State'} licence — apply for it on foscos.fssai.gov.in (or with your CA), then enter the licence number here under “Already have a licence?”.`,
  };
}

export const FOOD_CATEGORIES = [
  'Cooked meals / thali / biryani',
  'Tiffin & breakfast items',
  'Snacks & fried items',
  'Bakery, cakes & bread',
  'Sweets & confectionery',
  'Dairy & dairy-based items',
  'Fruits, vegetables & salads',
  'Pickles, chutneys & spice mixes',
  'Non-vegetarian items (meat, fish, egg)',
  'Beverages (non-alcoholic)',
] as const;

export const WATER_SOURCES = ['Municipal supply', 'Borewell / groundwater', 'Packaged / purified (RO)', 'Water tanker'] as const;

export const ID_TYPES = [
  { value: 'aadhaar', label: 'Aadhaar' },
  { value: 'pan', label: 'PAN card' },
  { value: 'voter', label: 'Voter ID' },
  { value: 'driving_licence', label: 'Driving licence' },
] as const;
export type IdType = (typeof ID_TYPES)[number]['value'];

export const DECLARATIONS = [
  'I declare that the information I provide is true and correct to the best of my knowledge.',
  'I will comply with the Food Safety and Standards Act, 2006 and the rules and regulations made under it.',
  'I understand that PadosiPlate only helps me prepare — I will submit the application myself on the official FSSAI portal and pay government fees directly to FSSAI.',
] as const;

export const MIN_YEARS = 1;
export const MAX_YEARS = 5;

/** Government fee for Basic Registration: ₹/year × years (default ₹100/year), in paise. */
export function basicRegistrationFeePaise(years: number, perYearRupees: number): number {
  if (!Number.isInteger(years) || years < MIN_YEARS || years > MAX_YEARS) throw new RangeError(`years must be ${MIN_YEARS}–${MAX_YEARS}`);
  return perYearRupees * 100 * years;
}

export const PERSISTENT_NOTICE =
  'PadosiPlate helps you prepare. You submit the application yourself on the official FSSAI portal (foscos.fssai.gov.in). Government fees are paid directly to FSSAI.';

export type FormAAnswers = {
  eligibility: Eligibility;
  foodCategories: string[];
  years: number;
  waterSource: string;
  idType: IdType;
  declarations: string[];
};

/** Validates wizard input; returns the first problem or null. */
export function validateFormA(a: Partial<FormAAnswers>): string | null {
  if (!a.eligibility || checkEligibility(a.eligibility).route !== 'form_a') return 'Basic Registration (Form A) is only for home kitchens under ₹12 lakh selling within Telangana';
  if (!Array.isArray(a.foodCategories) || a.foodCategories.length === 0) return 'Choose at least one food category';
  if (a.foodCategories.some((c) => !(FOOD_CATEGORIES as readonly string[]).includes(c))) return 'Unknown food category';
  if (!Number.isInteger(a.years) || (a.years as number) < MIN_YEARS || (a.years as number) > MAX_YEARS) return `Choose 1–5 years`;
  if (!a.waterSource || !(WATER_SOURCES as readonly string[]).includes(a.waterSource)) return 'Choose your source of water';
  if (!a.idType || !ID_TYPES.some((t) => t.value === a.idType)) return 'Choose an ID type';
  if (!Array.isArray(a.declarations) || DECLARATIONS.some((d) => !a.declarations!.includes(d))) return 'Please accept all declarations';
  return null;
}

/** Form A section structure used by the filing pack. */
export function buildFormASections(input: {
  applicantName: string;
  phone: string;
  email: string | null;
  kitchenName: string;
  kitchenAddress: string;
  form: FormAAnswers & { feeInPaise: number };
  documents: { label: string }[];
}) {
  const f = input.form;
  return [
    { title: 'Section 1 — Applicant details', rows: [['Name of applicant', input.applicantName], ['Mobile', input.phone], ['Email', input.email ?? '—'], ['ID proof', ID_TYPES.find((t) => t.value === f.idType)?.label ?? f.idType]] },
    { title: 'Section 2 — Business & premises', rows: [['Name of the food business', input.kitchenName], ['Premises address', input.kitchenAddress], ['Kind of business', 'Food service — home kitchen (confirm exact Kind of Business on FoSCoS)']] },
    { title: 'Section 3 — Food categories', rows: f.foodCategories.map((c, i) => [`${i + 1}`, c]) },
    { title: 'Section 4 — Duration & fee', rows: [['Registration period', `${f.years} year${f.years === 1 ? '' : 's'}`], ['Government fee payable to FSSAI', `₹${(f.feeInPaise / 100).toLocaleString('en-IN')}`]] },
    { title: 'Section 5 — Source of water', rows: [['Source', f.waterSource]] },
    { title: 'Section 6 — Documents', rows: input.documents.map((d, i) => [`${i + 1}`, d.label]) },
    { title: 'Section 7 — Declaration', rows: f.declarations.map((d, i) => [`${i + 1}`, d]) },
  ] as { title: string; rows: string[][] }[];
}
