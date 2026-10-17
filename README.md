# PadosiPlate 🍛

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
npm ci
npm run dev              # http://localhost:3000
```

With `DATABASE_URL` empty the app uses an embedded PGlite database in `.data/` (migrated and seeded with demo data in development). `MOCK_MODE=true` (the default) replaces Razorpay, geocoding and FSSAI lookups with realistic in-app simulations, and e-mails go to a dev outbox (`/admin/outbox`, or `GET /api/dev/outbox?to=…` outside production).

Demo accounts (development only, password `demo1234`): buyer `9999999901`, seller `9999999902`, admin `admin@demo.padosiplate.example`.

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
| `npm run icons` | regenerate PNG/SVG icons from the brand mark |

## Deploy on Replit (Autoscale)

1. **Import** the GitHub repo into Replit. The `.replit` file already installs Node 20 + PostgreSQL 16 and sets the Autoscale build (`npm ci && npm run db:bootstrap && npm run build`) and run (`npm run start`, bound to `0.0.0.0`).
2. Open the **PostgreSQL** tool and create a database → `DATABASE_URL` is added to Secrets automatically. In production the app **refuses to start without it** (no silent demo database).
3. Open the **Object Storage** tool, create a bucket, and set `STORAGE_ADAPTER=replit` and `REPLIT_OBJECT_STORAGE_BUCKET`. (Autoscale instances have no persistent disk.)
4. Add the **Secrets** below. Keep `MOCK_MODE=true` until you are ready for real payments.
5. **Deploy → Autoscale.** The health check is `GET /api/health`.
6. Log in with an e-mail listed in `ADMIN_EMAILS` — see [docs/PILOT_LAUNCH_CHECKLIST.md](docs/PILOT_LAUNCH_CHECKLIST.md).

### Secrets

| Secret | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | yes | set by the PostgreSQL tool |
| `JWT_SECRET` | yes | `openssl rand -hex 32` |
| `ADMIN_EMAILS` | yes | comma-separated. Only these addresses **with a verified e-mail** can become admin |
| `SITE_URL` | yes | public URL, used in e-mails, QR codes and OG images |
| `MOCK_MODE` | yes | `true` until go-live, then `false` |
| `CRON_SECRET` | yes | bearer token for `POST /api/cron/run` (Replit Scheduled Deployment or any pinger, e.g. hourly) |
| `STORAGE_ADAPTER` + `REPLIT_OBJECT_STORAGE_BUCKET` | yes on Autoscale | alternatives: `s3` (+ `S3_*`), `local` (dev only) |
| `EMAIL_ADAPTER` + `RESEND_API_KEY` + `EMAIL_FROM` | for real e-mail | `mock` writes to the outbox only. Verification and reset links need real e-mail in the pilot |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | when `MOCK_MODE=false` | platform fees only |
| `DOC_ENCRYPTION_KEY` | optional | 32-byte hex key for the AES-GCM encryption of id/address-proof uploads (derived from `JWT_SECRET` when absent — set it separately so rotating `JWT_SECRET` does not orphan stored documents) |
| `GEOCODE_API_KEY` | optional | society/kitchen geocoding; mock otherwise |
| `FSSAI_VERIFY_API_KEY` | optional | live licence lookup; mock otherwise |

The platform's own FSSAI central licence number is entered in `/admin/settings` (`platformFssaiCentralLicenseNo`).

### Going live with Razorpay (platform fees only)

1. In the Razorpay dashboard create **live API keys** and put them in Secrets.
2. Add a **webhook** → `https://<your-domain>/api/webhooks/razorpay`, secret = `RAZORPAY_WEBHOOK_SECRET`, events: `payment.captured`, `payment.failed`, `refund.processed`, `refund.failed`.
3. Set `MOCK_MODE=false`, redeploy. Do one ₹1 plan purchase and one small order whose fee you pay and then refund (see the checklist).

Do **not** add Razorpay Route, Smart Collect or anything that receives food money without first getting proper licensing advice.

### Flipping the other adapters

| Adapter | Variable | Live value |
| --- | --- | --- |
| Payments | `MOCK_MODE` | `false` |
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

- Next.js 14 App Router + TypeScript, Drizzle ORM (migrations in `drizzle/`), Tailwind, Framer Motion, custom JWT auth with DB-backed sessions (revocable), CSRF Origin check in `src/middleware.ts`.
- Brand and legal placeholders: `src/config/brand.ts` (single source; a test scans the repo for legacy names).
- Money maths in integer paise / basis points: `src/lib/money/fees.ts`.
- Mock-first adapters: payments, storage, e-mail, geocode, FSSAI.
- Postgres fixed-window rate limiter shared by all instances; times are stored UTC and shown in IST.
- Decisions and assumptions: [DECISIONS.md](DECISIONS.md) ("Phase 1 Pilot" section). Audit: [docs/AUDIT.md](docs/AUDIT.md). Security notes: [SECURITY.md](SECURITY.md).

## Legal

The legal pages under `/legal/*` are **drafts, to be reviewed by a lawyer**. `BRAND.gstin`, the registered address and the grievance officer are placeholders until you fill them in `/admin/settings`.
