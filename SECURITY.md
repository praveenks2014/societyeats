# Security

## Secrets audit (Pilot Hardening Phase 1, 2026-09-01)

`.env` is gitignored (verified — see `.gitignore`) and no `.env` file has ever
been committed. `git log --all -p -- .env` returns nothing, and the only
`JWT_SECRET` string tracked in git is the placeholder in `.env.example`
(`change-me-to-a-long-random-string`), which is not a real credential. **No
live secret was found anywhere in the repository or its history.** If that
ever changes — a key gets pasted into a commit, a screenshot, a chat log —
treat it as compromised and rotate it immediately using the steps below;
don't rely on `git revert` or history rewriting alone, since a secret that
was ever pushed to a remote must be assumed seen.

All secrets are read from environment variables only (`process.env.*`).
There is no hardcoded fallback for any of them — in particular,
`JWT_SECRET` has no default value; the app validates required env vars at
boot (`src/instrumentation.ts` → `src/lib/env.ts`) and refuses to start
without it, rather than silently signing sessions with a guessable key.

## Where each secret is used

| Variable | Used in | Purpose |
| --- | --- | --- |
| `JWT_SECRET` | `src/lib/auth/index.ts` | Signs/verifies the session cookie (HS256 JWT) |
| `DATABASE_URL` | `src/lib/db/index.ts` | Postgres connection string (includes a password) |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | `src/lib/payments/index.ts` | Live checkout + payment-signature HMAC |
| `RAZORPAY_WEBHOOK_SECRET` | `src/app/api/webhooks/razorpay/route.ts` | Webhook signature HMAC |
| `PORTER_API_KEY` / `SHADOWFAX_API_TOKEN` / `BORZO_AUTH_TOKEN` | `src/lib/delivery/providers/*.ts` | Live delivery-provider adapters (dormant while `MOCK_MODE=true`) |
| `FSSAI_VERIFY_API_KEY` | `src/lib/fssai/verify.ts` | Live FSSAI license verification (dormant while `MOCK_MODE=true`) |

## Rotation steps

Rotating any secret is a three-step swap; the app has no code that caches a
secret beyond a single process's lifetime, so a fresh deploy is always
enough to pick up a new value.

1. **Issue a new value.**
   - `JWT_SECRET`: generate a new one — `openssl rand -hex 32`. Rotating it
     invalidates every existing session cookie (everyone is signed out);
     that's expected and safe.
   - `RAZORPAY_*`: regenerate from the Razorpay Dashboard → Settings → API
     Keys (and → Webhooks for the webhook secret). Revoke the old key
     there — regenerating alone doesn't always invalidate the previous one.
   - `PORTER_API_KEY` / `SHADOWFAX_API_TOKEN` / `BORZO_AUTH_TOKEN` /
     `FSSAI_VERIFY_API_KEY`: regenerate via each provider's dashboard/SPOC
     and ask them to revoke the old credential.
   - `DATABASE_URL`: rotate the database password (Replit's PostgreSQL tool
     → Neon dashboard, or your Postgres provider), which changes the whole
     connection string.
2. **Update where it's stored** (see the Replit reminder below — never edit
   a value directly in code).
3. **Redeploy**, then confirm the old value no longer works (e.g. an old
   Razorpay key gets a 401 from their API) before considering the rotation
   complete.

## Replit deployment secrets

This app is designed to run on Replit unmodified (`.replit` is committed).
Secrets on Replit are **never** set via a committed `.env` file — Replit
provides its own encrypted store:

1. Open the Repl → **Tools → Secrets** (padlock icon).
2. Add each variable from `.env.example` as a Secret (key/value), not as
   plain text anywhere in the Repl's files. `DATABASE_URL` is set for you
   automatically once you add the **PostgreSQL** tool.
3. Secrets set in the Tools panel are available to both the dev **Run**
   button and an **Autoscale** deployment — but they're two separate
   scopes. If you add or rotate a secret after already deploying, open
   **Deploy → Autoscale → Settings** and confirm the new value is present
   there too (or redeploy), since a running deployment doesn't always
   pick up a Secret change until its next deploy.
4. Never commit a `.env` file to this repo. `.gitignore` already excludes
   `.env`, `.env.local`, and `.env*.local` — keep it that way.

## Reporting a concern

There is no public bug bounty for this pilot. If you find a security issue,
contact the grievance/support address in `src/lib/config.ts` (`BRAND`)
rather than opening a public issue.


## Phase 1 Pilot additions

- **No food money:** the platform never receives or routes food payments; Razorpay is used only for the platform's own fees. No bank account numbers or PAN are collected.
- **Admin access** requires an address in `ADMIN_EMAILS` *and* a verified e-mail; the first login forces a password change. Nothing in the app promotes a user to admin.
- **Sessions** are DB-backed and revocable (`/api/auth/logout-all`); passwords are bcrypt-hashed; e-mail verification and reset tokens are random, single-use and stored only as hashes.
- **CSRF:** `src/proxy.ts` rejects mutating `/api/*` requests whose `Origin` is not the site. **Rate limits** are in Postgres, so they hold across Autoscale instances.
- **Uploads:** magic-byte checked, EXIF stripped, id/address proofs encrypted at rest (AES-256-GCM, key from `DOC_ENCRYPTION_KEY`), served only through an authorised route. Aadhaar images must be masked in the browser first.
- **Webhooks:** Razorpay signatures verified, events de-duplicated, amounts asserted, captured payments never downgraded.
- **FSSAI:** the assistant never asks for FoSCoS passwords/OTPs and never files on a seller's behalf.
- Dev endpoints (`/api/dev/*`) return 404 in production.

## Pilot v2 hardening (completion run)

**Content Security Policy.** `src/proxy.ts` issues a fresh nonce per request:
`script-src 'self' 'nonce-…' 'strict-dynamic' https://checkout.razorpay.com` (no `'unsafe-inline'` or `'unsafe-eval'` for scripts in production), `style-src 'self' 'unsafe-inline'` (Tailwind and React inline styles), `frame-src` limited to Razorpay and OpenStreetMap (the order-page map), `object-src 'none'`, `frame-ancestors 'none'`, and `report-uri /api/csp-report` plus `report-to csp`. Violation reports are logged (directive and blocked origin only, no query strings). Every page is rendered dynamically, which is what lets Next attach the nonce. The Playwright fixture (`tests/e2e/fixtures.ts`) fails any test that sees a CSP violation, an uncaught page error or a console error.

**Access control tests** (`tests/unit/security-idor.test.ts`). The route tree is walked from disk: every `src/app/api/**/route.ts` must call a session guard, or be on an explicit public list, or authenticate by secret (webhook, cron). Anonymous callers must get 401/403 on every protected route and method; a buyer must get 403 on every `/api/admin/*` and `/api/seller/*` route; a seller on every admin route; a stranger or another kitchen gets 403/404 on someone else's order, invoice, chat, review, complaint and actions. `/api/dev/*` answers 404 unless `E2E=true` and not production.

**Serialisation** (`tests/unit/security-serialisation.test.ts`). The field set of the order view for buyer, kitchen and admin, before and after booking, is snapshotted; no response may contain a secret-like key (hashes, TOTP secrets, API keys) at any depth; the buyer's phone is not in the kitchen's view.

**Logging** (`src/lib/log.ts`). JSON lines with PII-named keys redacted and phone numbers or emails inside free text masked (`maskPii`). `x-request-id` is set by the proxy and echoed on responses; an unexpected 500 returns `Something went wrong (reference <id>)` and logs the same reference, so support can find the line without the user's data in it.

**Rate limits** (`tests/unit/security-ratelimit.test.ts`). Login, register, forgot/reset password, login-code request/verify, email verification and society access requests answer 429 after their configured burst per IP (and per identifier where the route has one); another IP is unaffected.
