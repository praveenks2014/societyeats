# PadosiPlate 🍛

**Home food from your neighbours.** PadosiPlate is a mobile-first, installable-PWA marketplace where residents of one Hyderabad gated society sell home-cooked food to their own neighbours — self-pickup by default (₹0, no delivery cost to subsidize), seller-run delivery for a fee the seller keeps, and a feature-flagged third-party delivery overflow (Porter → Shadowfax → Borzo, with automatic failover) for when neither of those fits. PadosiPlate is the **merchant of record**: payments settle to the platform (deemed supplier under Sec 9(5) CGST for home-food orders), GST is collected and shown on every invoice, and cooks are paid out as disclosed suppliers on a manual T+2 cadence. FSSAI compliance is an honest guidance center — instant license verification, self-file-only guided FoSCoS applications, and a regulatory "deemed commencement" publishing gate (see [FSSAI compliance](#2a-fssai-compliance-self-file-only)), never a fake government submission API. A second mode — **Mall Mode**, food-court order-ahead pickup via a QR landing page — exists and works end-to-end but is deferred for this pilot (`FEATURE_MALL_MODE` off by default).

Everything ships with **MOCK_MODE=true**: payments, delivery dispatch, rider tracking, and FSSAI verification are realistic in-app simulations (latency, random failures, staged rider progress), so the entire product is clickable end-to-end with **zero external keys**. Flip env vars later to go live — see the [going-live checklist](#going-live-checklist).

> Rebrand in one file: `src/lib/config.ts` (name, tagline, fees, `BRAND.gstin`/`registeredAddress`/`grievanceOfficer` — all placeholders that MUST be replaced with real values before a real pilot launch). Design tokens: `tailwind.config.ts`.

## Screenshots

_(placeholder — add screenshots of: parallax home hero, browse grid with fulfillment badges, checkout's self-pickup/seller-delivery/platform-delivery chooser, order tracking with failover log, seller FSSAI wizard, admin pilot-metrics dashboard, admin payout batch, GST invoice)_

## Demo accounts (password for all: `demo1234`)

| Role | Phone | What to try |
| --- | --- | --- |
| 🛒 Buyer | `9999999901` | Browse → cart → choose fulfillment (self-pickup / seller-delivery / platform-delivery) → mock pay → OTP handover → rate → refer a neighbour |
| 👩‍🍳 Seller | `9999999902` | Order queue → accept → ready → earnings, payouts & GST invoices → FSSAI compliance center → onboarding photos → review replies |
| 🍽️ Restaurant | `9999999903` | Counter console: incoming pickups → ready → verify buyer OTP (Mall Mode — flagged off by default, see below) |
| 🛠️ Admin | `9999999904` | Sellers, FSSAI queue, complaints, payout batches, pilot metrics + kill/pivot checkpoints, delivery provider chaos toggle, feature flags & platform settings |

Three more seller accounts (`9999999905`–`07`) and two more restaurant managers (`9999999910`–`11`) round out the seed; see `DECISIONS.md` for exactly which society/mall each belongs to.

### What's in the seed

- **2 societies, 1 live**: Aparna Cyberzon (`isLive: true` — the pilot's one publicly-joinable society, invite code `CYBERZON`) and My Home Avatar (`isLive: false` — demonstrates the invite-code-only path, code `AVATAR-EARLY`).
- **9 home kitchens** across both societies with a deliberate mix of FSSAI states (verified / pending-application / awaiting-admin-check / unverified-unapproved) and fulfillment settings (self-pickup only, or self-pickup + seller-delivery at a seller-set fee and radius) — 6 "core" kitchens plus 3 introduced specifically to drive 8 weeks of realistic pilot-metrics history (one that joins and keeps growing, one that goes quiet after week 3 — a churn demo, one that joins late — a growth demo). One core kitchen (Mishti Ghor) demonstrates the FSSAI "enter it anytime" flow directly out of the box: a license number + certificate on file `awaiting_admin_check`, on a kitchen that *also* has a FoSCoS filing old enough to be deemed-eligible under the regulation — see [FSSAI compliance](#fssai-compliance-self-file-only) below.
- **26 dishes** (20 across the 6 core kitchens, 6 more from the 3 metrics-history kitchens), plus GVK One mall with 3 counters × 5 items (Mall Mode — code retained, flagged off; see [Feature flags](#feature-flags-featuremallmode-and-others)).
- **~175 orders**, including 8 weeks of Aparna-Cyberzon-only history across **all three fulfillment types** (self-pickup, seller-delivery, platform-delivery), a shifting weekly mix, a hand-verified week-4 retention cohort, and GST-inclusive totals throughout.
- **4 complaints**: 1 open (wrong item), 1 open (not received), 2 resolved with a 25% partial refund each — so `/admin/complaints` shows both live and already-handled states.
- **2 payout batches**: one already marked `paid` (with a demo UTR reference), one still `pending` — including a real refund deduction line item from the two resolved complaints above — so `/admin/payouts` and `/seller/earnings` both show a complete, real T+2 cycle out of the box.
- **1 referral credit**, pre-granted so `/refer` and checkout's "apply credit" toggle both have a real case without a fresh signup.

## Run it locally

```bash
cp .env.example .env
# edit .env and set JWT_SECRET — e.g. `openssl rand -hex 32` — the app
# refuses to start without one (no dev fallback). DATABASE_URL can stay
# empty: leaving it unset is the zero-setup path (embedded PGlite).

npm install
npm run db:push     # no DATABASE_URL? uses embedded PGlite (WASM Postgres) at ./.data
npm run db:seed
npm run dev         # http://localhost:3000 — fully clickable in MOCK_MODE
```

`npm run build` (which also regenerates `public/sw.js` via the `prebuild` script) and `npm test` (the SQL radius-filter boundary test) should both stay green — CI-equivalent checks to run before any deploy.

## GitHub → Replit runbook

1. Push this repo to GitHub, then in Replit choose **Create Repl → Import from GitHub**.
2. Add the **PostgreSQL** tool in your Repl (Tools → PostgreSQL). Replit provisions a Neon database and sets `DATABASE_URL` automatically.
3. Add **Secrets** (Tools → Secrets) — see `SECURITY.md` for the full table and rotation steps:
   - `JWT_SECRET` — any long random string (`openssl rand -hex 32`)
   - `MOCK_MODE` — `true` (keep mocks) — later `false` with the keys below, only once the [going-live checklist](#going-live-checklist) is actually done
   - `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` — for live checkout
   - optional provider keys: `PORTER_API_KEY`, `SHADOWFAX_API_TOKEN`, `BORZO_AUTH_TOKEN`, `FSSAI_VERIFY_API_KEY` (only matter once `platformDeliveryEnabled` is turned on — see below)
4. In the Replit shell: `npm run db:push && npm run db:seed`
5. Hit **Run** (dev) — then **Deploy → Autoscale** for a public URL (build/run commands are preconfigured in `.replit`).

---

## Pilot runbook

This is the day-to-day operating guide for running PadosiPlate in one live gated society (200–500 households).

### 1. Launch the society

- A society goes live by setting `societies.isLive = true` (seeded for Aparna Cyberzon) — only live societies appear in the public registration dropdown (`GET /api/societies?live=1`).
- A society that isn't public yet can still onboard residents via its `inviteCode` (e.g. `AVATAR-EARLY`) shared directly — e.g. a phased building-by-building rollout, or a private cohort ahead of general availability. Share the code via the society's WhatsApp group along with `/register?ref=<a resident's referral code>` links for warm invites (`/refer` generates these).
- Set `societies.targetHouseholds` (editable inline on `/admin/metrics`) to the society's real unit count — this drives the weekly penetration % on the pilot dashboard.

### 2. Onboard sellers

- A new seller completes `/seller/onboarding` (kitchen photos — minimum 3 required before the profile-completion nudge clears — plus optional video, cuisines, "cooking since") and the FSSAI compliance step (`/seller/compliance`).
- A seller then sets their fulfillment options on `/seller/fulfillment`: self-pickup (pickup instructions, always available, ₹0), seller-delivery (their own fee + delivery radius — that fee is the seller's money; commission never applies to it), and a per-meal-slot order cap.
- An admin approves the seller (`/admin/sellers`) before their listings go live to buyers (subject to the FSSAI publishing gate below).

### 2a. FSSAI compliance (self-file only)

Every new FSSAI application is **self-filed** — the seller files it on FoSCoS themselves, at their own pace. PadosiPlate never claims to file anything on a seller's behalf through this UI; there is no public FoSCoS submission API for any third party to call. (A legacy `filingMode: 'facilitator'` back-office path from an earlier phase still exists in the backend and database for the handful of applications already filed that way, and its admin actions on `/admin/fssai`'s **Applications queue** tab still work — it's just no longer offered as a choice in the wizard.)

- **Guided application** (`/seller/compliance` → "Get me a license", shown when a seller has no FSSAI status at all): defaults to **Basic Registration** (turnover ≤ ₹1.5cr, guidance only — some categories need a State License regardless of turnover, confirmed per kitchen on FoSCoS). Submitting generates a prefilled application summary + document bundle at `/fssai/[id]/summary`, with a step-by-step FoSCoS walkthrough — the seller files it themselves and comes back to enter the FoSCoS reference number once they have it.
- **Enter it anytime** (`/seller/compliance`, persistent whenever the kitchen isn't yet FSSAI-verified — including while an application is pending): a seller who already has a license — from an earlier application, or filed independently — enters the 14-digit number and uploads a certificate (PDF/JPG/PNG, required). PadosiPlate verifies it automatically; if the licensee name matches the seller's own name or kitchen name, the green badge appears immediately. Otherwise it's queued as `awaiting_admin_check` for a human to confirm — see below.
- **Regulatory publishing gate**: a seller may publish/re-activate dishes once FSSAI-verified, **or** once a FoSCoS filing has gone unanswered past the regulation's own "deemed commencement" window — 7 days for Basic Registration, 60 days for a State License — unless FoSCoS responded in that window with a rejection, an inspection order (Basic Registration), or an inadequacy notice (State License), recorded by an admin on the Applications queue the moment they learn of it. FoSCoS has no status-tracking API, so this is entirely reference-number-and-elapsed-time based, not polled — PadosiPlate nudges the seller in-app (🔔 bell) once the window passes, with a reminder to enter their license number the moment FoSCoS actually grants it.

**Admin: manually checking a license on FoSCoS.** `/admin/fssai`'s **Verify licenses** tab lists every seller in `awaiting_admin_check`, with the seller's name/kitchen name/kitchen address shown side-by-side against the number they entered and whatever PadosiPlate's verification adapter found (if anything). To confirm one by hand:

1. Open the seller's uploaded certificate (📎 link on the row) and read off the licensee name, address, and expiry date printed on it.
2. Click **Check on FoSCoS →** (opens `foscos.fssai.gov.in` in a new tab — no deep link exists, so search/look up the license there yourself) and cross-check the number, name, and status independently of what's on the certificate image.
3. Tick the three confirmations — name matches the seller, address matches the kitchen, expiry is in the future — only once you've actually verified each one; **Mark verified** stays disabled until all three are ticked (and the server re-checks this too, not just the UI).
4. If anything doesn't check out, use **Reject** with a short reason instead — the seller is notified in-app and returned to their previous status (still mid-application if one exists, otherwise unverified) so they can correct and resubmit.

Every verify/reject action is appended to that seller's own timeline, visible on this same row on a future visit.

### 3. Feature flags (`FEATURE_MALL_MODE` and others)

Every flag below lives in `platform_config` (not a build-time env var) and is editable live on **`/admin/settings`** — no redeploy needed:

| Flag | Default | What it gates |
| --- | --- | --- |
| `FEATURE_MALL_MODE` (`mallModeEnabled`) | **off** | The food-court QR order-ahead storefront (`/m/[mallSlug]`). The code is fully retained and untested-nothing-broke when re-enabled — it's just not the right fit for a single gated-society pilot. Off: the homepage stops linking to it and the page itself 404s; `POST /api/orders`'s mall-pickup branch also hard-rejects as a second line of defense. |
| `platformDeliveryEnabled` | **off** | The third-party delivery overflow (Porter/Shadowfax/Borzo via the existing failover orchestrator). Self-pickup and seller-delivery are always available regardless of this flag; this only adds platform-facilitated delivery as a buyer-selectable option once turned on, with its own minimum-order threshold and a fee passed through to the buyer at cost. |
| Buyer platform fee (`platformFeePaise`) | ₹0 | A flat per-order fee charged to the buyer, on top of the bill. ₹0 at pilot launch by founder decision. |
| Referral credit (`referralCreditPaise` / `referralCreditCapPerUser`) | ₹30, cap 5/user | The credit a referrer earns once a referred neighbour completes their first order, and the lifetime cap on how many a single referrer can earn. |

Other admin-editable settings worth knowing about during a live pilot: `radiusKm` (the hyperlocal delivery boundary), `commissionHomePct`/`commissionMallPct`, `fssaiSponsorshipCapPerCohort`, `platformFssaiCentralLicenseNo` (see [going-live checklist](#going-live-checklist)), and the week-8/week-14 kill-pivot checkpoint thresholds (see below).

### 4. Watch the pilot metrics dashboard

`/admin/metrics` (per society) tracks weekly: household penetration vs. `targetHouseholds`, active buyers, week-4 cohort retention, repeat order rate, order volume/AOV/fulfillment mix, active sellers + seller churn, net revenue per order, and refund/complaint rate — each against the brief's fixed targets (≥15% week-4 retention, <3% refund/complaint rate) plus admin-editable **kill/pivot checkpoints** at week 8 and week 14 (default: 20%/8% at week 8, 35%/15% at week 14, for penetration/retention respectively). Export any week's numbers as CSV from the same page.

### 5. Handle complaints

A buyer can raise a complaint within `complaintWindowHours` (default 24h) of delivery/pickup (`/orders/[id]` → report an issue). An admin resolves it on `/admin/complaints` with one of: full refund, partial refund, warning, or seller pause — refunds are recorded against the order and payment immediately and deducted from that seller's *next* payout batch (see below). Three UPHELD `hygiene` complaints auto-pause a seller (the same approval flag admins use for a manual suspend).

---

## Payout batch procedure

PadosiPlate is the merchant of record: buyer payments settle to the platform, not directly to the cook, so cooks are paid out as disclosed suppliers on a manual **T+2** cadence (Razorpay Route stays a stubbed adapter — `src/lib/payments/settlements.ts` — until real payout volume justifies automating this). This is a recurring, twice-weekly-or-so admin task:

1. Open **`/admin/payouts`** and click **Generate T+2 batch**. This sweeps every `delivered`/`picked_up` order that (a) hasn't already been swept into an earlier batch and (b) completed more than 48 hours ago (`PAYOUT_HOLD_HOURS` in `src/lib/payouts.ts`, giving a buffer for same-day disputes), groups it by seller, and creates one `pending` payout row per seller. It also sweeps in any *newly-recorded* complaint refund on an order from an already-paid earlier batch, as a clean top-line deduction on this new batch — never a retroactive rewrite of a past one.
2. Each payout row shows: gross sales, commission, an estimated gateway-fee deduction, Sec 194-O TDS (0.1%, only once a seller's cumulative financial-year gross payouts cross ₹5,00,000 — tracked automatically), any refund deduction, and the net payable amount plus the seller's payout VPA/bank on file.
3. Click **Export CSV** for the list of pending payouts (seller, destination, amount, order count) and action the actual bank/UPI transfers outside PadosiPlate — there is no automated payout rail yet.
4. Once a transfer is confirmed, come back and **mark it paid**, entering the UTR/reference number from the transfer. This is the only way a payout's status changes — there's no auto-reconciliation.
5. Repeat on a T+2 cadence (the disclosed schedule shown to sellers on `/seller/earnings` is "paid every day for orders completed 2 days earlier" — in practice, batch generation is a manual admin action, not a cron, so "every day" means "whenever the admin runs it," typically daily or every couple of days for a single-society pilot).

A per-order GST tax invoice (5% on home-food orders, itemized alongside subtotal/delivery fee/platform fee/commission) is available to both buyer and seller at `/orders/[id]/invoice` at any time — this is what a seller's own accountant will want alongside the payout CSV at tax time.

---

## The 30-second failover demo (chaos toggle) 🧨

1. Log in as **admin** → *Delivery providers* → **🧨 Force down** on Porter (priority 1).
2. Turn on `platformDeliveryEnabled` in *Settings* (off by default — this demo needs the platform-delivery fulfillment option available).
3. In another tab as **buyer**: order a dish, choose **platform delivery** at checkout, pay in the mock checkout.
4. As **seller** (`9999999902`): accept → start cooking → **Mark ready → find rider**.
5. Open the buyer's order page: the **Delivery dispatch log** shows `porter → failed (Chaos toggle…)`, then `shadowfax → success`, and a Shadowfax rider is on the way. Every attempt is timestamped in `deliveries.attemptsJson`.
6. Bonus: force *all three* down and the order lands in `delivery_unassigned`, the admin gets an in-app alert, and *Admin → Orders* offers **Retry dispatch**. Providers that fail 5× consecutively auto-disable.

## MOCK_MODE explained

`MOCK_MODE=true` (default) swaps every adapter's live branch for a simulation:

- **Payments** — a styled PadosiPlate Pay sheet with "Pay (test)" and "Simulate failure" buttons; capture runs through the same idempotent `markOrderPaid` path as the real webhook.
- **Delivery** — quotes are deterministic (₹30–₹70 by distance, per-provider pricing personalities), `createDelivery` fails ~15% of the time to exercise failover, and tracking progresses on the clock: rider assigned → picked up (~1 min) → in transit (~3 min) → "arrived, share OTP".
- **FSSAI verification** — any 14-digit number verifies (a deterministic holder name from a small fixed list, uncorrelated with the real seller — so most "enter it anytime" submissions realistically land on the admin Verify licenses queue rather than auto-matching, same as a live adapter would); numbers ending `0000` return "not found" so you can demo the error path. No real government API is ever called, in mock or live mode — every FSSAI/GST statement in the UI is worded as guidance with a "verify on FoSCoS / with your CA" footnote, and applications are always filed on FoSCoS by the seller themselves.
- **Rider OTP** — the buyer's tracking screen includes a mock "rider's handset" to enter the OTP and complete delivery; self-pickup and mall-pickup instead surface the OTP field on the seller/counter side.

Set `MOCK_MODE=false` and the same code paths call Razorpay and Porter/Shadowfax/Borzo using your keys. Live request shapes are marked `// VERIFY against partner docs when keys arrive`. `MOCK_MODE=false` also activates one hard gate: **`POST /api/orders` refuses every order with a 503** until an admin has entered the platform's own FSSAI Central e-commerce license number on `/admin/settings` (`platformFssaiCentralLicenseNo`, empty by default — see the checklist below) — a persistent red banner across every `/admin/*` page reminds you this is outstanding.

## Going-live checklist

Everything below must be genuinely done — not just configured — before flipping `MOCK_MODE=false` for real households and real money:

- [ ] **Platform FSSAI Central e-commerce License** — PadosiPlate itself (not any individual cook) needs this before real orders are legally allowed; enter the real 14-digit number in `/admin/settings` once granted. Until then, `POST /api/orders` hard-blocks with a 503 whenever `MOCK_MODE=false` (dormant, and harmless, while `MOCK_MODE=true`).
- [ ] **Razorpay KYC + webhook** — complete business KYC, generate live keys, and register the webhook `https://<app>/api/webhooks/razorpay` (events: `payment.captured`, `payment.failed`) with `RAZORPAY_WEBHOOK_SECRET`. Razorpay Route (for splitting seller payouts automatically) stays a stub (`src/lib/payments/settlements.ts`) — the T+2 manual batch tool above is the real payout mechanism for this pilot.
- [ ] **CA sign-off on the Sec 9(5) CGST treatment** — PadosiPlate operates as the deemed supplier for home-food orders (platform collects and remits the 5% GST shown on every invoice; cooks are paid out as suppliers, not registered GST filers, via the T+2 batch). Get a chartered accountant to formally confirm this treatment, the invoice numbering/format (`/orders/[id]/invoice`), and the Sec 194-O TDS logic (0.1% once a seller's FY gross payouts cross ₹5,00,000) before real money moves. Replace the placeholder `BRAND.gstin`/`registeredAddress` in `src/lib/config.ts` with PadosiPlate's real, allotted values — the invoice UI flags these as placeholders until then.
- [ ] **Grievance officer details in `/legal`** — `src/lib/config.ts`'s `BRAND.grievanceOfficer` is currently a placeholder shown on `/legal/terms` ("as required by the Consumer Protection (E-Commerce) Rules, 2020"). Replace it with a real named officer, contact details, and confirm the 48-hour-acknowledgement / 30-day-resolution commitment is actually operationally staffed, not just printed.
- [ ] **Deployment secrets** — every secret in `SECURITY.md`'s table set as a real value in your host's secret store (Replit Secrets, never a committed `.env`): `JWT_SECRET`, `DATABASE_URL`, `RAZORPAY_KEY_ID`/`KEY_SECRET`/`WEBHOOK_SECRET`, and — only if `platformDeliveryEnabled` is turned on — `PORTER_API_KEY`, `SHADOWFAX_API_TOKEN`, `BORZO_AUTH_TOKEN`; `FSSAI_VERIFY_API_KEY` if a live verification provider is wired in. Confirm `.env` is still gitignored and re-run the secrets grep in `SECURITY.md` before every launch, not just once.

Two smaller items worth doing at the same time, even though they don't block launch: swap `/public/uploads` for real object storage (Replit Object Storage or S3 — `src/app/api/uploads/route.ts` is the single place to change), and confirm delivery-provider business onboarding (Porter for Enterprise / Shadowfax Flash / Borzo business API) matches the request shapes marked `// VERIFY against partner docs when keys arrive` in `src/lib/delivery/providers/*` — only relevant once `platformDeliveryEnabled` is turned on.

## Razorpay test cards & UPI

In test mode use: card `4111 1111 1111 1111` (any future expiry, any CVV), or success UPI `success@razorpay` / failure UPI `failure@razorpay`. Full list: https://razorpay.com/docs/payments/payments/test-card-details/

## Architecture notes

- **Next.js 14 App Router + TypeScript**, single repo for pages + API route handlers. Port comes from `process.env.PORT` (Replit-ready). No Docker, no workers, no Redis.
- **Drizzle ORM + postgres-js** against `DATABASE_URL`; with no URL set, an embedded **PGlite** (WASM Postgres) database gives a zero-setup local demo. Same schema, same queries.
- **No background jobs anywhere**: mock rider progress is derived from timestamps at read time; tracking syncs lazily when someone views an order; payout batches, FSSAI grace-window pauses, and slot-capacity checks are all computed lazily on the relevant request rather than by a cron.
- **Fulfillment**: self-pickup (default, ₹0) → seller-delivery (seller's own fee, commission on item subtotal only) → platform-delivery (feature-flagged overflow via the delivery orchestrator below, minimum order + pass-through fee). `orders.fulfillmentType` drives dispatch/OTP branching, not the older `orders.type` (home vs. mall).
- **Delivery orchestrator** (`src/lib/delivery/orchestrator.ts`): priority list from `provider_health`, 8s timeout per provider, every attempt logged to `deliveries.attemptsJson`, consecutive-failure auto-disable, admin chaos toggle, `delivery_unassigned` + admin alert when all fail. Dormant unless `platformDeliveryEnabled` is on.
- **Merchant of record / money**: GST (5%, home-food orders only) is collected on the platform's behalf and shown on every bill and on a per-order tax invoice; a `payouts` table tracks each T+2 batch (gross sales, commission, estimated gateway fee, Sec 194-O TDS, refund deductions, net payable) generated and marked-paid entirely by an admin — see the [payout batch procedure](#payout-batch-procedure) above.
- **Compliance guardrails**: sellers can publish only once FSSAI-verified, or once a FoSCoS filing is old enough to be deemed-eligible under the regulation's own commencement window (7/60 days for Basic Registration/State License — see [FSSAI compliance](#2a-fssai-compliance-self-file-only)); a license can be entered and verified at any time via the compliance page's persistent "enter it anytime" card, auto-verified on a name match or queued for a human check on `/admin/fssai`'s Verify licenses tab otherwise; every listing shows the license number, the FoSCoS reference once eligible, or a verification-in-progress badge; checkout shows the full bill breakup including GST; the platform's own FSSAI Central License gates real (non-mock) order creation.
- **Trust & hygiene**: kitchen onboarding (photos/video/cuisines), seller reply-to-review, and a buyer complaint flow (refund + payout deduction, hygiene auto-pause) — see the pilot runbook above.
- **Society-first growth**: invite-code + live-society signup gating, WhatsApp share links with Open Graph images, a referral-credit ledger, and a "kitchen of the week" home-page slot.
- **Pilot metrics**: `/admin/metrics` computes weekly penetration/retention/order/fulfillment-mix/complaint-rate numbers per society against fixed targets and admin-editable kill/pivot checkpoints — see above.
- **Feature flags**: every flag (`mallModeEnabled`, `platformDeliveryEnabled`, buyer platform fee, referral credit amount/cap, and more) lives in `platform_config`, read via `src/lib/db/platform.ts`'s `getPlatformSettings()`, editable live on `/admin/settings` — no redeploy needed for any of them.
- **Auth**: phone + password with an httpOnly JWT cookie; the auth module is structured so an OTP provider (MSG91) can replace the password check without touching session handling. `JWT_SECRET` is mandatory — `src/instrumentation.ts` validates required env vars (via `src/lib/env.ts`, zod) at server boot and refuses to start with a clear, complete list of what's missing, rather than failing on the first request that needs a secret.
- **Rate limiting**: an in-memory token bucket (`src/lib/rate-limit.ts`) throttles login, registration, order creation, and delivery-OTP verification — fine for this pilot's single instance; swap for a shared store before running more than one.
- **10 km radius filter**: enforced in SQL (a Haversine expression in the `browseListings` query, `src/lib/browse.ts`) against indexed `lat`/`lng` columns, not filtered in application code after the fact. `npm test` proves the boundary: 9.9 km in, 10.1 km out.
- **PWA**: manifest + hand-rolled service worker generated from `public/sw.template.js` (see `scripts/gen-sw.mjs`, run via the `prebuild` npm script) with a cache name stamped from `package.json`'s version plus a fresh build id, so every deploy busts every older cache. Network-first for HTML navigations and `/api/*` GETs (falling back to the last cached copy, or the offline shell, only when offline); cache-first for static assets and remote images. A returning visitor whose tab has an older worker waiting sees an "Update available — reload" prompt (`src/components/sw-register.tsx`).

See `DECISIONS.md` for the full, dated log of every assumption and judgment call made while building this — including exactly why each of the choices above was made, in the order it was made.
