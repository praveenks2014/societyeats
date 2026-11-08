# Kootu 🍛

**Home food from your neighbours.** Residents of a gated society register, kitchens list dishes after an admin review, and neighbours order for self-pickup or kitchen delivery.

## How the money works (read this first)

| | |
| --- | --- |
| **Food money** | Paid by the buyer **directly to the kitchen** (UPI to the kitchen's own VPA, or cash/UPI at pickup). The platform never collects, holds or routes it. The platform holds no payment-aggregator licence. |
| **Revenue line 1** | **Kitchen subscription** – a plan of N months (admin-configurable plans, incl. a free launch period). Paid to the platform through Razorpay. |
| **Revenue line 2** | **Buyer platform fee** – default 10% of the food value (floor/cap configurable), paid to the platform through Razorpay at checkout. |
| **Razorpay** | Used **only** for the platform's own fees (subscriptions and buyer fees) and their refunds. |

All rates are edited in `/admin/settings` (bounds-checked). Each order and each subscription payment **snapshots** the rates in force, so changing a setting never alters history.

## Quick start (local, zero keys)

```bash
cp .env.example .env     # set JWT_SECRET (openssl rand -hex 32)
npm ci            # Node >= 22.12
npm run dev              # http://localhost:3000
```

With `DATABASE_URL` empty the app uses an embedded PGlite database in `.data/` (migrated and seeded with demo data in development). `MOCK_MODE=true` (the default) replaces Razorpay, geocoding and FSSAI lookups with realistic in-app simulations, and e-mails go to a dev outbox (`/admin/outbox`, or `GET /api/dev/outbox?to=…` outside production) **unless `EMAIL_ADAPTER=resend` is set**: that overrides `MOCK_MODE`, so a trial with real residents can run with `MOCK_MODE=true` and real e-mail.

Demo accounts (development only, password `demo1234`): buyer `9999999901`, seller `9999999902`, admin `admin@demo.kootu.example`.

### Scripts

| Script | What it does |
| --- | --- |
| `npm run typecheck` / `lint` | `tsc --noEmit` / `next lint` |
| `npm test` | Vitest unit + integration tests (PGlite, no network) |
| `npm run test:e2e` | Playwright: 10 journeys on desktop + mobile (390px) layout checks, against `next dev` on PGlite with `MOCK_MODE=true` |
| `npm run verify` | all of the above |
| `npm run db:bootstrap` | apply migrations + idempotent production bootstrap (default plans, settings, templates). Never seeds demo data |
| `npm run uploads:migrate` | move legacy `public/uploads` files into the StorageAdapter |
| `npm run cron` | run the scheduled jobs once (expiry sweeps, reminders, retention purge) |
| `npm run icons:generate` | rebuild the brand images (icons, maskable icon, wordmark, PNG sizes) from `src/config/brand.json` |

## Deploy on Replit (Autoscale)

1. **Import** the GitHub repo into Replit. The `.replit` file already installs Node 22 + PostgreSQL 16 and sets the Autoscale build (`npm ci && npm run db:bootstrap && npm run build`) and run (`npm run start`, bound to `0.0.0.0`).
2. Open the **PostgreSQL** tool and create a database → `DATABASE_URL` is added to Secrets automatically. In production the app **refuses to start without it** (no silent demo database).
3. Open the **Object Storage** tool, create a bucket, and set `STORAGE_ADAPTER=replit` and `REPLIT_OBJECT_STORAGE_BUCKET`. (Autoscale instances have no persistent disk.)
4. Add the **Secrets** below. Keep `MOCK_MODE=true` until you are ready for real payments. Set `EMAIL_ADAPTER=resend` (with `RESEND_API_KEY` and `EMAIL_FROM` on a **verified Resend domain**) as soon as real people sign up, even while `MOCK_MODE=true`: verification and reset links need real e-mail. `/admin/go-live` has an "Email delivery" row that is red while mails only go to the outbox.
5. **Deploy → Autoscale.** The health check is `GET /api/health`.
6. Log in with an e-mail listed in `ADMIN_EMAILS` — see [docs/PILOT_LAUNCH_CHECKLIST.md](docs/PILOT_LAUNCH_CHECKLIST.md).

### Secrets

| Secret | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | yes | set by the PostgreSQL tool |
| `JWT_SECRET` | yes | `openssl rand -hex 32` |
| `SITE_URL` | yes | public URL, used in e-mails, QR codes and OG images |
| `MOCK_MODE` | yes | `true` until go-live, then `false` |
| `CRON_SECRET` | yes | bearer token for `POST /api/cron/run`; schedule it every 5 minutes, see [Scheduled jobs on Autoscale](#scheduled-jobs-on-autoscale-required) |
| `STORAGE_ADAPTER` + `REPLIT_OBJECT_STORAGE_BUCKET` | yes on Autoscale | alternatives: `s3` (+ `S3_*`), `local` (dev only) |
| `EMAIL_ADAPTER=resend` + `RESEND_API_KEY` + `EMAIL_FROM` (e.g. `Kootu <no-reply@mail.<your-domain>>`) | for real e-mail (go-live) | Without `EMAIL_ADAPTER=resend`, mails go to `/admin/outbox` only (that is the default only while `MOCK_MODE=true`; `MOCK_MODE=false` implies Resend). Resend delivers to arbitrary addresses only from a verified domain (not `resend.dev`) |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | optional (needed once `MOCK_MODE=false`) | **The key prefix decides the payments mode** (see below). Platform fees only |
| `PAYMENTS_ADAPTER=mock` | optional | forces the fake checkout even if Razorpay keys are present (e2e uses it) |
| `ADMIN_EMAILS` | yes | `praveenece.mit@gmail.com,rsaralipriya@gmail.com`; admins enrol two-factor on first login. Only these addresses **with a verified e-mail** can become admin |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | optional | enables "Continue with Google" (never auto-links an existing email account) |
| `RAZORPAYX_ACCOUNT_NUMBER` | optional | needed only for the `razorpayx_rpd` UPI verification provider |
| `DOC_ENCRYPTION_KEY` | optional | 32-byte hex key for the AES-GCM encryption of id/address-proof uploads (derived from `JWT_SECRET` when absent — set it separately so rotating `JWT_SECRET` does not orphan stored documents) |
| `GEOCODE_API_KEY` | optional | society/kitchen geocoding; mock otherwise |
| `FSSAI_VERIFY_API_KEY` | optional | live licence lookup; mock otherwise |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | optional | browser push; generate with `npm run vapid:generate`. Push is off without them |

The platform's own FSSAI central licence number is entered in `/admin/settings` (`platformFssaiCentralLicenseNo`).

### Backups (automatic, to Object Storage)

The 5-minute cron job also takes **one database backup a day, after 03:00 IST**, and writes it to Object Storage under `backups/` (so it survives Autoscale's temporary disks). It uses `pg_dump` when the binary exists, and otherwise an in-process export (gzipped JSON lines of every table in dependency order, with the schema version and migration hash in a manifest; encrypted columns stay as the stored ciphertext; uploaded files are not part of it). It keeps the newest `backupKeepDaily` (14) backups plus `backupKeepWeekly` (8) weekly ones. `/admin/go-live` shows "Database backups" (amber if none, failed, or older than 26 hours) with a **Run backup now** button (needs a fresh 2FA check and is audited), and a backup failure alerts both admins once per incident. **Restore** into a new, empty database with `npm run db:restore -- <backup-key>` (see the "Restore drill" in `docs/ADMIN_RUNBOOK.md`).

### Scheduled jobs on Autoscale (required)

Replit Autoscale has no built-in cron, so `POST /api/cron/run` never runs on its own. Schedule it **every 5 minutes** with an external scheduler. These steps use cron-job.org (free):

1. Sign up at [cron-job.org](https://cron-job.org) and click **Create cronjob**.
2. **Title:** `Kootu scheduled jobs`. **URL:** `https://<SITE_URL>/api/cron/run` (your deployed domain, e.g. `https://kootu.replit.app/api/cron/run`).
3. **Execution schedule:** **Every 5 minutes** (cron-job.org: "Every 5 minutes"). The jobs also run the order timers (accept deadlines, unpaid-order expiry, reminders), so a long gap delays those.
4. Open the **Advanced** tab:
   - **Request method:** `POST`
   - **Headers → Add:** name `Authorization`, value `Bearer <CRON_SECRET>` (the exact value you stored in Replit Secrets, after the word `Bearer` and one space)
5. Save, then press **Test run**. A healthy response is HTTP `200` with `{"ok":true, ...}`. `401` means the secret is wrong or `CRON_SECRET` is not set on the deployment.
6. In cron-job.org enable **notifications on failure**, so you hear about it if the endpoint starts failing.
7. Open `/admin`: the red "Scheduled jobs have not run" banner disappears once a run has been recorded. It comes back whenever there has been no successful run for **`cronStaleMinutes` (default 15 minutes, an admin setting)**, and both admins also get an in-app and e-mail alert once per incident. A late run never stops ordering.

**What stops working if this is not scheduled** (Autoscale has no built-in cron, so nothing calls the route by itself):
- **Subscription expiry and grace:** status is still derived from dates on read, but reminder emails and the expiry sweep do not run.
- **Reminders:** kitchen reminders to confirm UPI payments and subscription/FSSAI renewal reminders.
- **Unpaid-order expiry:** orders waiting for the platform fee are not expired, so the stock and referral credit reserved for them are not released.
- **Document retention:** id/address proofs are not purged on schedule, and old rate-limit rows are not pruned.

You can also run `npm run cron` once from the Replit shell to run the same jobs manually.

### Payments modes (separate from `MOCK_MODE`)

`MOCK_MODE` now only governs the non-payment adapters (geocoding, FSSAI lookup, delivery, SMS/WhatsApp). How payments behave is decided by the Razorpay keys:

| Keys | Mode | What happens |
| --- | --- | --- |
| none, or `PAYMENTS_ADAPTER=mock` | `mock` | the fake checkout sheet; `/api/payments/mock-complete` exists |
| `RAZORPAY_KEY_ID=rzp_test_…` | `razorpay_test` | real Razorpay Checkout and API in **test mode**: no real money. Works with `MOCK_MODE` true or false. The go-live guard does not apply. A banner says "Test payments: no real money is charged." |
| `RAZORPAY_KEY_ID=rzp_live_…` | `razorpay_live` | **real money**. Before every money-taking action (order fee, kitchen plan, Plus, meal plan, bulk order, the ₹1 UPI check) the go-live configuration rows must be done, and `MOCK_MODE` must be `false` (otherwise every such action is refused with "Live Razorpay keys need MOCK_MODE=false") |
| any other prefix | refused | payments return 503 until the key is fixed |

The fake routes (`mock-complete` and the mock branches of Plus and the ₹1 check) answer **404 in `razorpay_test` and `razorpay_live`**, so a deployment with real keys can never mark anything paid for free. `/api/health` and `/admin/go-live` show the current mode (never a key).

### Using an existing Razorpay account

1. **Test and live are separate worlds**: separate keys and separate webhooks. Create the webhook in the same mode as the keys you are using (Razorpay Dashboard → toggle Test/Live → Settings → Webhooks).
2. **Webhook** → `https://<your-domain>/api/webhooks/razorpay`, events: `payment.authorized`, `payment.captured`, `payment.failed`, `refund.processed`, `refund.failed`. Add `fund_account.validation.completed` and `fund_account.validation.failed` only if you use the `razorpayx_rpd` UPI provider. The secret you type when creating the webhook goes into `RAZORPAY_WEBHOOK_SECRET`.
3. **The account is shared with your other apps.** Razorpay sends the events of *every* payment on the account to *every* webhook URL. Kootu tags its orders (`notes.app='kootu'`, plus `env`, `kind`, `ref`; receipts start with `pp-`) and acknowledges anything that is not its own with HTTP 200 `ignored_foreign` (it never refunds or captures a foreign payment, and keeps only the event id for duplicate protection, purged after `webhookEventRetentionDays`, default 30). Your other apps must do the same for Kootu's events: ignore any event whose order has `notes.app='kootu'`.
4. Before taking **live** payments add the Kootu website URL to the Razorpay account's website/app details.
5. Fees settle to the account's bank account. The invoice legal entity in `/admin/settings` should match the Razorpay account holder.
6. **Check the keys**: `npm run razorpay:check` creates a ₹1 order tagged for this app, reads it back and prints its id and status. It opens no checkout and captures nothing; it refuses to run in `mock` mode and prints "Razorpay rejected the keys…" on a 401.

### Going live with Razorpay (platform fees only)

1. Put the **live** keys (`rzp_live_…`) and the live webhook secret in Secrets.
2. Create the **live** webhook as above.
3. Get every configuration row on `/admin/go-live` green, then set `MOCK_MODE=false` and `EMAIL_ADAPTER=resend`, redeploy. Run `npm run razorpay:check`, then do one ₹1 plan purchase and one small order whose fee you pay and then refund (see the checklist).

Do **not** add Razorpay Route, Smart Collect or anything that receives food money without first getting proper licensing advice.

### Flipping the other adapters

| Adapter | Variable | Live value |
| --- | --- | --- |
| Payments | `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` (prefix picks test or live) | `rzp_live_…` and `MOCK_MODE=false` |
| Storage | `STORAGE_ADAPTER` | `replit` or `s3` |
| E-mail | `EMAIL_ADAPTER` | `resend` |
| Geocoding | `GEOCODE_API_KEY` | set it |
| FSSAI lookup | `FSSAI_VERIFY_API_KEY` | set it |

## Product map

- **Residents**: `/join/<code>` (society invite page with share preview), register, e-mail verification (unverified users may browse and order, with a banner), browse "My society / Nearby", order with a two-part bill (food → kitchen, platform fee → Razorpay), anonymous per-order chat with the kitchen.
- **Kitchens** (`/seller`): onboarding checklist → listing request, dishes (moderated), UPI VPA, subscription, fulfilment, FSSAI assistant, inbox with admin, food-refunds-due list.
- **Admin** (`/admin`): requests, kitchens (approve / request changes / delist / relist), dish review, societies and share poster, users, settings, revenue dashboard, refunds, complaints, outbox, FSSAI funnel and walkthrough content.
- **FSSAI Form A assistant** (`/seller/compliance`): eligibility routing, the Form A answers, a FoSCoS walkthrough, Aadhaar masking in the browser. It never asks for FoSCoS passwords/OTPs and never files on a seller's behalf.
- **Order lifecycle** (`src/lib/orders/state.ts`): `placed → fee_paid → (awaiting_kitchen_payment_confirmation for UPI) → paid → accepted → preparing → ready → picked_up` (or `out_for_delivery → delivered` for kitchen delivery), plus `cancelled`, `expired`, `refund_pending`. Transitions are exactly-once, stock is reserved and released, and a rejected order's platform fee is refunded.

## Architecture notes

- Next.js 14 App Router + TypeScript, Drizzle ORM (migrations in `drizzle/`), Tailwind, Framer Motion, custom JWT auth with DB-backed sessions (revocable), CSRF Origin check in `src/proxy.ts`.
- Brand and legal placeholders: `src/config/brand.ts` (single source; a test scans the repo for legacy names).
- Money maths in integer paise / basis points: `src/lib/money/fees.ts`.
- Mock-first adapters: payments, storage, e-mail, geocode, FSSAI.
- Postgres fixed-window rate limiter shared by all instances; times are stored UTC and shown in IST.
- Decisions and assumptions: [DECISIONS.md](DECISIONS.md) ("Phase 1 Pilot" section). Audit: [docs/AUDIT.md](docs/AUDIT.md). Security notes: [SECURITY.md](SECURITY.md).

## Brand and renaming

The product's name, slug, short code and tagline live in **`src/config/brand.json`** (`name`, `slug`, `shortCode`, `tagline`); `src/config/brand.ts` derives everything else from them: receipt prefix (`kt-`), invoice prefix (`KT/<FY>/<serial>`), cookie and browser-storage prefix (`kootu_…`), the Razorpay `notes.app` tag, the manifest and the service-worker cache name. To rename: edit those four values, run `npm run icons:generate`, and nothing else in the code needs to change (seeded legal text and disclaimers are written with `{{brand}}`). Earlier names stay listed in `brand.ts` (`legacy*`) so test orders already on a shared Razorpay account, `pp-` receipts and old browser-storage keys keep working. Existing invoices are never renumbered. A repo scan (`tests/unit/no-legacy-brand.test.ts`) fails if an earlier name reappears outside `brand.ts`, `DECISIONS.md` and the migrations.

## Legal

The legal pages under `/legal/*` are **drafts, to be reviewed by a lawyer**. `BRAND.gstin`, the registered address and the grievance officer are placeholders until you fill them in `/admin/settings`.

## Pilot v2 operations

- Cron: call `POST /api/cron/run` every 5 minutes (the admin banner appears after 15 minutes of silence; `/api/health` shows `cronAgeMinutes` and `mockMode`).
- `npm run db:bootstrap` — production-safe setup. `npm run db:seed:demo` — demo data, refuses in production. `npm run db:backup` — manual `pg_dump` into `./backups` (the automatic backups below do not need it).
- Webhook events handled at `/api/webhooks/razorpay`: payments, refunds, `fund_account.validation.*` and the ₹1 UPI check orders.
- Go-live: `/admin/go-live` lists the configuration prerequisites (these, and only these, make the live guard refuse new orders when `MOCK_MODE=false`) and the operational checks (storage, cron heartbeat, push keys, legal review), which alert the admins but never stop an order. UPI provider at launch is `razorpay_checkout_vpa`; `mock` is refused when `MOCK_MODE=false`.
- End-to-end tests (`npm run e2e`) run `next dev` on port 3100 against a throw-away PGlite database in `os.tmpdir()/kootu-e2e`; a fixture fails any test with a CSP violation or console error. Pass `--trace off` for speed.
- Optional features (meal plans, featured placement, Plus, bulk orders, campaigns) are admin flags and default off.
- Docs: [ADMIN_RUNBOOK](docs/ADMIN_RUNBOOK.md), [SELLER_GUIDE](docs/SELLER_GUIDE.md), [BUYER_FAQ](docs/BUYER_FAQ.md), [DECISIONS](DECISIONS.md#pilot-v2).
