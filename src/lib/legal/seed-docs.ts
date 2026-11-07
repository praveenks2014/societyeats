/**
 * Seed text of the ten legal documents (Markdown, DRAFT pending lawyer review).
 * Placeholders `{{key}}` are filled at render time from settings (see src/lib/legal/render.ts).
 * Seeded once; a later admin edit publishes a new version and is never overwritten by bootstrap.
 */
export type SeedDoc = { slug: string; title: string; body: string };

export const LEGAL_SLUGS = ['terms', 'privacy', 'refunds', 'kitchen-terms', 'food-safety', 'prohibited-items', 'community-guidelines', 'how-ranking-works', 'grievance', 'fssai-help'] as const;
export type LegalDocSlug = (typeof LEGAL_SLUGS)[number];

export const SEED_DOCS: SeedDoc[] = [
  {
    slug: 'terms',
    title: 'Terms of Use',
    body: `# Terms of Use

{{appName}} (operated by {{entity}}) is a neighbourhood marketplace that helps residents discover and order food from independent home kitchens in their society and nearby societies. We are a technology platform. We do not cook, sell, deliver or handle food, and we are not a party to the sale of food between a buyer and a kitchen.

## Who can use it
- You must be 18 or older and belong to a society that has been invited to the pilot.
- Give correct details and keep your password and sign-in codes safe.
- We may suspend accounts that break these terms, the Kitchen Terms or the Community Guidelines.

## How money works
- **You pay the kitchen directly for the food, at your door, after it arrives.** Pay by UPI to the kitchen's verified UPI ID (or cash for pickup if the kitchen accepts it). {{appName}} never collects, holds or routes food payments.
- **The platform fee** (currently {{feePct}}% of the food value, between {{feeMin}} and {{feeMax}}{{gstNote}}) is {{appName}}'s own service charge. It is paid online through Razorpay when you book and is shown separately from the food price before you pay.
- Kitchens pay {{appName}} a subscription to be listed. That is also the platform's own charge.
- {{appName}} does not hold a payment-aggregator licence and does not act as escrow or a settlement agent.

## Orders
- An order is sent to the kitchen once the platform fee is paid. A booking whose fee is not paid within {{unpaidMin}} minutes expires.
- A kitchen may accept or decline. If it declines, or does not accept within {{acceptMin}} minutes, the order is cancelled and your platform fee is refunded automatically.
- After the kitchen accepts, cancelling by you keeps the platform fee. See the Cancellations, refunds and credits page.
- The food contract is between you and the kitchen.

## Disputes
If a payment is disputed, {{appName}} reviews both sides and decides. We can refund the platform fee, issue credit, warn or suspend an account. We cannot recover food payments made outside the platform.

## Liability {#liability}
To the extent permitted by law, {{appName}}'s liability for any order is limited to the platform fee paid for that order.

## Contact and grievances
{{grievance}} · {{supportEmail}}`,
  },
  {
    slug: 'privacy',
    title: 'Privacy Notice',
    body: `# Privacy Notice

This notice is drafted with the Digital Personal Data Protection Act, 2023 and the DPDP Rules, 2025 in mind. {{appName}} collects only what the marketplace needs to work.

## What we collect
- **Account:** name, phone number, email address, tower and flat, and your consent records (what you accepted, which version, when).
- **Sign-in:** a password hash, sign-in code hashes, device and IP data for security alerts. Logs are kept for at least one year, as the Rules require.
- **Orders and payments:** order contents, status and the platform-fee payment. UPI and card details go directly to Razorpay.
- **Kitchens:** PAN (encrypted, shown masked), UPI ID and registered name from the ₹1 check, FSSAI details and uploads, kitchen photos.
- **Chat:** messages and images between a buyer and a kitchen on an order.

## Why we use it
To run orders, verify kitchens, prevent fraud, resolve disputes, send service messages and meet legal duties. We send marketing only if you opt in.

## Who sees what
- Kitchens see a first name and your society, and your flat only after they accept (hidden again 24 hours after completion). Your phone number is shared only if you switch sharing on for that order.
- The kitchen's UPI ID and QR appear only to the buyer at the door.
- We do not sell personal data.

## Retention
Chats are removed 180 days after an order closes (unless a dispute is open). Verification screenshots are removed 180 days after a decision. Sign-in codes are removed after 24 hours.

## Your rights
You can access, correct, and erase your data, nominate someone, and complain. Use Account, or write to {{supportEmail}}. We reply within 30 days. You can also complain to the Data Protection Board of India.

## Breaches
If personal data is breached we will tell affected users and the Board without delay.

## Children
{{appName}} is for adults only (18+).`,
  },
  {
    slug: 'refunds',
    title: 'Cancellations, refunds and credits',
    body: `# Cancellations, refunds and credits

Food money travels directly between you and the kitchen, so refunds work in two parts.

## The platform fee (paid to {{appName}} through Razorpay)
- **Kitchen declines, cancels, or does not accept in time:** the full platform fee is refunded, and you also get the same amount as {{appName}} credit (except an unanswered order, where you get the refund only).
- **You cancel before the kitchen accepts:** full refund.
- **You cancel after the kitchen accepts:** the platform fee is kept. A strike applies only after repeated late cancellations.
- **You could not pay at the door, or were not there:** the fee is kept and a strike is recorded.
- **Upheld complaint:** {{appName}} decides whether to refund all or part of the fee, or give credit.
- Refunds normally reach your account in 5 to 7 working days.

## The food (paid directly to the kitchen)
- You pay only after the food reaches you. If you have not paid, there is nothing to refund.
- If you paid and a complaint is upheld, the kitchen owes you the food refund. {{appName}} does not hold food money, so it tracks outstanding refunds and can suspend kitchens that do not return them.

## Credit
Credit reduces the platform fee on your next orders, before GST. It is not cash and cannot be withdrawn.

## Kitchen subscriptions
Non-refundable except at {{appName}}'s discretion.

## How to complain
Open the order and tap Report an issue within 24 hours. See the Grievance page for timelines.`,
  },
  {
    slug: 'kitchen-terms',
    title: 'Kitchen Terms',
    body: `# Kitchen Terms

These terms apply to residents who list a home kitchen on {{appName}}.

## Your undertakings
- Dish names, photos and descriptions are accurate.
- Food is freshly prepared in your own kitchen.
- You hold, or have applied for, the FSSAI registration or licence that fits your business, and you keep it current.
- You will honour cancellations and follow the dispute process.
- You are responsible for your own income tax and GST on your food sales.
- You accept the strike and suspension rules and the provisional sales limits while an FSSAI application is pending.

## Listing and subscription
- A kitchen pays a subscription to be listed ({{graceDays}}-day grace period after it ends, during which dishes stay visible). After grace, dishes are hidden, not deleted.
- Founding kitchens get 90 days free. The subscription is non-refundable except at {{appName}}'s discretion. Early renewals stack.
- Each kitchen and dish is reviewed. We may approve, ask for changes, or decline.

## You are paid directly
- Buyers pay you at their door, after the food arrives, by UPI to your verified UPI ID (or cash for pickup). You confirm payments you receive.
- {{appName}} does not collect, hold or pay out your food sales and takes no commission on them. Buyers pay the platform fee separately.
- Changing your UPI ID pauses your kitchen until the new one passes the ₹1 check.

## Orders and strikes
- Accept within {{acceptMin}} minutes. Declining a booked order refunds the buyer's fee and gives them credit, with no strike. Ignoring an order, or cancelling after accepting, earns a strike. {{sellerStrikeLimit}} strikes in {{strikeWindowDays}} days pauses your kitchen.
- You may switch on Not taking orders today so buyers see Closed today.

## Delisting
We may delist your kitchen or dishes, for example for hygiene concerns, repeated upheld complaints, misleading listings, an FSSAI problem, or unreturned buyer refunds. Orders you have accepted can still be completed. You will be told the reason.

## Contact
{{grievance}} · {{supportEmail}}`,
  },
  {
    slug: 'food-safety',
    title: 'Food Safety',
    body: `# Food Safety

Every kitchen on {{appName}} shows its FSSAI registration number, or "FSSAI applied: provisional" while its application is being processed. Kitchens file on the official FoSCoS portal themselves.

## What we check
- FSSAI details and documents before a kitchen shows a verified badge.
- Identity, UPI ownership and a manual review before a kitchen goes live.
- Ratings and reports. Kitchens that fall below expectations are delisted.

## What buyers should know
- Home-cooked food is prepared in domestic kitchens, not commercial facilities. {{appName}} does not inspect kitchens.
- Allergen information is declared by the kitchen. Confirm with the kitchen in chat if unsure.
- The veg, egg and non-veg mark follows the FSSAI green and brown convention and is declared by the kitchen.
- Most home kitchens qualify for Basic Registration (turnover up to ₹1.5 crore). Some categories need a State Licence regardless of turnover.

Platform licence: {{platformLicence}}`,
  },
  {
    slug: 'prohibited-items',
    title: 'Prohibited items',
    body: `# Prohibited items

Kitchens may not list the following. Listings that match are blocked or removed.
- Alcohol, tobacco, bhang, cannabis or any intoxicating product.
- Raw or uncooked meat and fish for sale.
- Home-canned foods.
- Infant formula and baby food.
- Supplements, vitamins and anything sold as medicine.
- Packaged foods, unless the pilot option is on and the full label (net quantity, dates, maker name and address) is given.
- Claims that food cures, treats or prevents a disease, or promises weight loss or immunity. Such wording sends a dish to manual review.

Allergens (gluten, milk, nuts, peanuts, soy, egg, fish, shellfish, sesame, mustard) must be declared on every dish.`,
  },
  {
    slug: 'community-guidelines',
    title: 'Community guidelines',
    body: `# Community guidelines

- Be kind and respectful. No abuse, harassment or discrimination by religion, caste, gender or community.
- Keep order chat about the order. Do not share phone numbers, addresses or payment details unless you both choose to.
- Pay the kitchen at the door after you receive the food. If you cannot pay, tell the kitchen at once.
- Repeated cancellations, no-shows or unpaid orders earn strikes and can pause your account.
- Report anything that worries you from the order page.`,
  },
  {
    slug: 'how-ranking-works',
    title: 'How ranking works',
    body: `# How ranking works

Kitchens in your own society appear first. After that we order by distance, then by rating, then by how recently a kitchen was active.

Ranking is never sold. Kitchens cannot pay to move up.

## Sponsored kitchens {#sponsored}

When this feature is switched on, a kitchen can be shown in its own clearly labelled "Sponsored" card at the top of the feed, for a fixed set of dates in one society. It is separate from the list below it: it does not change anyone's position in the ranking, and the same kitchen still appears in the ranked list where it would normally appear. At most one Sponsored card is shown at a time. It is switched off unless an admin turns it on.`,
  },
  {
    slug: 'grievance',
    title: 'Grievance redressal',
    body: `# Grievance redressal

If something went wrong, tell us. Open the order and tap Report an issue, or use the form on this page when you are signed in.

**Grievance Officer:** {{grievance}}
**Email:** {{supportEmail}}  **Phone:** {{supportPhone}}

## What happens next
- We acknowledge your complaint within {{ackHours}} hours.
- We aim to resolve it within {{resolveDays}} days and tell you the outcome. Data requests are answered within 30 days.
- For food safety you can also contact the FSSAI (Food Safety Connect). For consumer issues you can call the National Consumer Helpline (1915).`,
  },
  {
    slug: 'fssai-help',
    title: 'FSSAI help for home kitchens',
    body: `# FSSAI help for home kitchens

{{antiScam}}

Our guide helps you decide which FSSAI registration or licence fits your sales, and walks you through applying yourself on the official FoSCoS portal. {{appName}} never asks for your FoSCoS password and does not charge for FSSAI help.

## What the rules say
- Basic Registration: annual turnover up to ₹1.5 crore. Registrations are perpetual, with a ₹100 per year fee.
- E-commerce operators such as {{appName}} need an FSSAI Central Licence.
- Sources: FSSAI order of 13 March 2026 and the FSS (Licensing and Registration) Amendment Regulations 2026.

{{rulesNote}}`,
  },
];
