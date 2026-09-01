# GharSe 🍛

**Ghar ka khana, from your neighbourhood.** GharSe is a mobile-first, installable-PWA marketplace where residents of Indian gated societies sell home-cooked food to buyers within a 10 km radius — with online payments (Razorpay), third-party delivery with automatic failover (Porter → Shadowfax → Borzo), and an honest FSSAI compliance center that verifies licenses instantly and files new applications through a human back-office (no fake government APIs). A second mode — **Mall Mode** — lets food-court restaurants take order-ahead pickups via a QR landing page, with live inventory and OTP handover at the counter.

Everything ships with **MOCK_MODE=true**: payments, delivery dispatch, rider tracking, and FSSAI verification are realistic in-app simulations (latency, random failures, staged rider progress), so the entire product is clickable end-to-end with **zero external keys**. Flip env vars later to go live.

> Rebrand in one file: `src/lib/config.ts` (name, tagline, fees). Design tokens: `tailwind.config.ts`.

## Screenshots

_(placeholder — add screenshots of: parallax home hero, browse grid, checkout sheet, order tracking with failover log, seller FSSAI wizard, admin chaos toggle, mall QR page)_

## Demo accounts (password for all: `demo1234`)

| Role | Phone | What to try |
| --- | --- | --- |
| 🛒 Buyer | `9999999901` | Browse → cart → mock pay → live tracking → OTP handover → rate |
| 👩‍🍳 Seller | `9999999902` | Order queue → accept → ready (dispatches a rider) → earnings |
| 🍽️ Restaurant | `9999999903` | Counter console: incoming pickups → ready → verify buyer OTP |
| 🛠️ Admin | `9999999904` | Approvals, FSSAI queue, provider chaos toggle, live settings |

Seed data: 2 Hyderabad societies (Aparna Cyberzon & My Home Avatar, ~9 km apart), 6 home kitchens (verified / FSSAI-pending / unapproved), 20 dishes, GVK One mall with 3 counters × 5 items, 6 historical orders, reviews.

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

## GitHub → Replit runbook

1. Push this repo to GitHub, then in Replit choose **Create Repl → Import from GitHub**.
2. Add the **PostgreSQL** tool in your Repl (Tools → PostgreSQL). Replit provisions a Neon database and sets `DATABASE_URL` automatically.
3. Add **Secrets** (Tools → Secrets):
   - `JWT_SECRET` — any long random string
   - `MOCK_MODE` — `true` (keep mocks) — later `false` with the keys below
   - `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` — for live checkout
   - optional provider keys: `PORTER_API_KEY`, `SHADOWFAX_API_TOKEN`, `BORZO_AUTH_TOKEN`, `FSSAI_VERIFY_API_KEY`
4. In the Replit shell: `npm run db:push && npm run db:seed`
5. Hit **Run** (dev) — then **Deploy → Autoscale** for a public URL (build/run commands are preconfigured in `.replit`).

## The 30-second failover demo (chaos toggle) 🧨

1. Log in as **admin** → *Delivery providers* → **🧨 Force down** on Porter (priority 1).
2. In another tab as **buyer**: order a dish, pay in the mock checkout.
3. As **seller** (`9999999902`): accept → start cooking → **Mark ready → find rider**.
4. Open the buyer's order page: the **Delivery dispatch log** shows `porter → failed (Chaos toggle…)`, then `shadowfax → success`, and a Shadowfax rider is on the way. Every attempt is timestamped in `deliveries.attemptsJson`.
5. Bonus: force *all three* down and the order lands in `delivery_unassigned`, the admin gets an in-app alert, and *Admin → Orders* offers **Retry dispatch**. Providers that fail 5× consecutively auto-disable.

## MOCK_MODE explained

`MOCK_MODE=true` (default) swaps every adapter's live branch for a simulation:

- **Payments** — a styled GharSe Pay sheet with "Pay (test)" and "Simulate failure" buttons; capture runs through the same idempotent `markOrderPaid` path as the real webhook.
- **Delivery** — quotes are deterministic (₹30–₹70 by distance, per-provider pricing personalities), `createDelivery` fails ~15% of the time to exercise failover, and tracking progresses on the clock: rider assigned → picked up (~1 min) → in transit (~3 min) → "arrived, share OTP".
- **FSSAI verification** — any 14-digit number verifies (deterministic holder name); numbers ending `0000` return "not found" so you can demo the error path.
- **Rider OTP** — the buyer's tracking screen includes a mock "rider's handset" to enter the OTP and complete delivery.

Set `MOCK_MODE=false` and the same code paths call Razorpay, Porter/Shadowfax/Borzo, and a Surepass-style FSSAI verifier using your keys. Live request shapes are marked `// VERIFY against partner docs when keys arrive`.

## Going-live checklist

- [ ] **Razorpay**: complete KYC; generate live keys; add webhook `https://<app>/api/webhooks/razorpay` (events: `payment.captured`, `payment.failed`) with `RAZORPAY_WEBHOOK_SECRET`. Split seller payouts via **Razorpay Route** — adapter interface stubbed in `src/lib/payments/settlements.ts`.
- [ ] **Delivery**: business onboarding with Porter for Enterprise / Shadowfax Flash / Borzo business API; confirm request shapes in `src/lib/delivery/providers/*` against the docs your SPOC shares.
- [ ] **FSSAI verification key** (Surepass/AuthBridge-style) for instant license checks.
- [ ] **Platform FSSAI Central license** — GharSe itself needs a Central e-commerce FBO license before real operations (footer placeholder says "applied for").
- [ ] **GST registration** and invoice numbering; commission GST treatment.
- [ ] Legal review of `/legal/*` drafts; appoint the grievance officer named in Terms.
- [ ] Swap `/public/uploads` for Replit Object Storage or S3 (`src/app/api/uploads/route.ts` is the single place to change).

## Razorpay test cards & UPI

In test mode use: card `4111 1111 1111 1111` (any future expiry, any CVV), or success UPI `success@razorpay` / failure UPI `failure@razorpay`. Full list: https://razorpay.com/docs/payments/payments/test-card-details/

## Architecture notes

- **Next.js 14 App Router + TypeScript**, single repo for pages + API route handlers. Port comes from `process.env.PORT` (Replit-ready). No Docker, no workers, no Redis.
- **Drizzle ORM + postgres-js** against `DATABASE_URL`; with no URL set, an embedded **PGlite** (WASM Postgres) database gives a zero-setup local demo. Same schema, same queries.
- **No background jobs anywhere**: mock rider progress is derived from timestamps at read time; tracking syncs lazily when someone views an order.
- **Delivery orchestrator** (`src/lib/delivery/orchestrator.ts`): priority list from `provider_health`, 8s timeout per provider, every attempt logged to `deliveries.attemptsJson`, consecutive-failure auto-disable, admin chaos toggle, `delivery_unassigned` + admin alert when all fail.
- **Compliance guardrails**: sellers can't publish without FSSAI verified *or* a pending application (amber badge, 30-day grace, then auto-pause); every listing shows the license number or pending badge; checkout shows the full bill breakup.
- **Auth**: phone + password with an httpOnly JWT cookie; the auth module is structured so an OTP provider (MSG91) can replace the password check without touching session handling. `JWT_SECRET` is mandatory — `src/instrumentation.ts` validates required env vars (via `src/lib/env.ts`, zod) at server boot and refuses to start with a clear, complete list of what's missing, rather than failing on the first request that needs a secret.
- **Rate limiting**: an in-memory token bucket (`src/lib/rate-limit.ts`) throttles login, registration, order creation, and delivery-OTP verification — fine for this pilot's single instance; swap for a shared store before running more than one.
- **10 km radius filter**: enforced in SQL (a Haversine expression in the `browseListings` query, `src/lib/browse.ts`) against indexed `lat`/`lng` columns, not filtered in application code after the fact. `npm test` proves the boundary: 9.9 km in, 10.1 km out.
- **PWA**: manifest + hand-rolled service worker generated from `public/sw.template.js` (see `scripts/gen-sw.mjs`, run via the `prebuild` npm script) with a cache name stamped from `package.json`'s version plus a fresh build id, so every deploy busts every older cache. Network-first for HTML navigations and `/api/*` GETs (falling back to the last cached copy, or the offline shell, only when offline); cache-first for static assets and remote images. A returning visitor whose tab has an older worker waiting sees an "Update available — reload" prompt (`src/components/sw-register.tsx`).
