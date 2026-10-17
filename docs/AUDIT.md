# PadosiPlate (formerly "GharSe") — Phase 1 audit

Scope: the `societyeats` repo at commit `eddaa4b` (before branch `phase-1-pilot`).
Every item in the prior-audit checklist was verified against the code; the
verdict column says what the code actually does today. Each finding names the
step of the Phase 1 plan that fixes it.

## 1. What exists

| Area | State |
| --- | --- |
| Stack | Next.js 14 App Router, TypeScript, Drizzle ORM (postgres-js in prod, PGlite fallback), Tailwind, Framer Motion, zod, jose, bcryptjs |
| Auth | Phone + password; JWT in an httpOnly cookie carrying uid/role/name/phone for 30 days |
| Roles | buyer, seller, restaurant (Mall Mode), admin |
| Societies | `societies` with `inviteCode`, `isLive`; 10 km radius filter implemented in SQL (`browse.ts`) |
| Orders | `orders`, `order_items`, `order_events`, `payments`; fulfilment self-pickup / seller delivery / (flagged) platform delivery; 4-digit handover OTP |
| Money (old model) | Buyer pays the **whole** order through the platform's Razorpay; platform deducts commission and "pays out" to cooks in T+2 batches (`payouts.ts`), Route stub in `payments/settlements.ts` |
| FSSAI | Self-file wizard, filing pack, FoSCoS walkthrough, reference entry, admin verification queue, 7/60-day deemed-grant gate (`fssai/gate.ts`) |
| Trust | Complaints + refunds, reviews, referral credits, reputation badges |
| Mall Mode | Behind `mallModeEnabled` (default off) |
| Delivery | Porter / Shadowfax / Borzo adapters + mock, behind `platformDeliveryEnabled` |
| Ops | `.replit` (dev run + autoscale), env validation in `instrumentation.ts`, SW generator |
| Tests | One `node:test` file (SQL radius filter). No `typecheck`, no ESLint config, no e2e |

## 2. Findings (verified)

### S2 — money and payment correctness

| # | Finding | Verified | Fixed in |
| --- | --- | --- | --- |
| 1 | `/api/payments/verify` trusts client `orderId`; never ties `razorpay_order_id` to the order or the order to the session user | **True** — `markOrderPaid(body.orderId)` after only a signature check; one valid signature marks any order paid | Step 5.4 |
| 2 | Refunds never call Razorpay | **True** — `reject` flips `payments.status='refunded'`; complaint refunds only update DB columns | Step 5.4 (`refundPlatformFee`) |
| 3 | `markOrderPaid` read-then-write, no transaction; verify + webhook race | **True** — double stock decrement and double notify possible | Step 5.4 (conditional update, one winner) |
| 4 | Webhook: late `payment.failed` overwrites captured; amount not compared; refund/transfer events ignored; no dedupe | **True** | Step 5.4 |
| 5 | `verifyCheckoutSignature` calls `timingSafeEqual` with no length guard → 500 on malformed input | **True** | Step 5.4 |
| 6 | Stock decremented only after payment (overselling); unpaid orders never expire | **True** | Step 5.4 / 6 (reserve on create, 15-min expiry) |
| 7 | Referral credit consumed at order creation, never restored; partial use discards remainder | **True** — `applyCredit` marks whole rows `applied`; `creditToApply` caps but rows are not split | Step 5.4 (reserve/consume/release, row splitting) |
| 8 | Seller-delivery fee never paid out; 2% gateway estimate deducted from payouts; earnings page disagrees with payout maths; payout timing off `updatedAt` | **True** | **Resolved by removal** — Step 5.0 retires platform payouts for home-food orders |
| 9 | Admin settings unbounded (commission > 100% accepted); mall-path quantity not validated (negative subtotal); client omits platform fee on mall orders | **True** for all three | Step 5.4 (zod bounds). Mall qty validated defensively; Mall otherwise untouched behind its flag |
| 10 | Payout batch generation races and can duplicate | **True** | **Resolved by removal** (Step 5.0) |

### S1 — security, availability and access

| # | Finding | Verified | Fixed in |
| --- | --- | --- | --- |
| 11 | `/api/orders/[id]/verify-otp` never checks the caller is the order's seller — the buyer (who can see the OTP) can complete their own order | **True** | Step 6 |
| 12 | No admin provisioning (seeded demo admin 9999999904/demo1234); no `email` on users | **True** | Step 3 |
| 13 | Uploads written to `public/uploads` on local disk; any logged-in user may upload | **True** — lost on Autoscale, not reliably served by `next start` | Step 2.3 |
| 14 | `DATABASE_URL` unset → silent PGlite + demo seed with demo1234 accounts, even in production | **True** | Step 2.1 |
| 15 | Rate limiting is in-memory per instance | **True** | Step 2.4 |
| 16 | Slot windows use server-local hour (UTC server → 5.5 h off) | **True** — `now.getHours()` / `setHours` in `slots.ts` | Step 2.5 |
| 17 | JWT carries role for 30 days (no revocation); 6-char passwords; no reset | **True** | Step 3 |
| 18 | Restaurant console not feature-flagged | **True** — layout only checks role | Step 4.5 |
| 19 | "GharSe" in 118 places across 46 source files (+ docs): cookie name, SW cache, manifest, receipts, globalThis key | **True** | Step 1 |

### S4 / S6 / S7

| # | Finding | Verified | Fixed in |
| --- | --- | --- | --- |
| 20 | FSSAI wizard: no eligibility check, not framed as Form A, no Aadhaar masking, licence expiry not enforced | **True** — `fssaiExpiry` column exists but `isFssaiEligibleToPublish` ignores it | Step 8 |
| 21 | No buyer–seller contact channel | **True** | Step 7 |
| 22 | Only one test file | **True** (also: no `typecheck` script, no ESLint config — `npm run lint` prompted interactively) | Steps 0 / 11 |

### Additional findings

| # | Finding | Fixed in |
| --- | --- | --- |
| 23 | `npm run lint` was not runnable (no ESLint config); `typecheck` script absent | Step 0 (this commit) |
| 24 | `useLive` helper in delivery providers trips `react-hooks/rules-of-hooks` (name-only false positive) | Step 0 — renamed `shouldUseLive` |
| 25 | `orders.updatedAt` used as the "completed" time for payout/hygiene logic | Step 6 (`completed_at`) |
| 26 | Order create re-reads listing stock outside a transaction; `qty = max(1, min(...))` silently clamps then is not used in the availability check | Step 5.4 |
| 27 | `GET /api/orders/[id]` exposes the seller's real phone to buyers and buyer's phone/name to sellers | Step 7 (handles only) |
| 28 | Settings page has `platformFssaiCentralLicenseNo` hard-gating live orders — this is the platform's own e-commerce registration; kept, listed in "Known gaps" | Step 12 |
| 29 | Login page prints demo credentials unconditionally | Step 3 (shown only when demo data is seeded and not production) |
| 30 | `sessions`, audit log, outbox, webhook-event, rate-limit tables do not exist | Steps 2–5 |
| 31 | `proxy`/CSRF: mutating routes have no Origin check (sameSite=lax only) | Step 3.6 |

## 3. What this phase changes

1. **Brand** → PadosiPlate everywhere, single `BRAND` source, scan test.
2. **Foundations** → production DB required, bootstrap script, StorageAdapter (local / Replit Object Storage), Postgres rate limiter, IST time helpers, `/api/health`, Replit config.
3. **Auth** → email on users, email-or-phone login, allowlisted admins, DB-backed sessions, email verification + password reset, CSRF.
4. **Admin** → societies CRUD, resident approvals, kitchen listing requests, dish moderation, delist/relist, admin↔kitchen inbox, users page.
5. **Money model** → the platform no longer touches food money. Kitchen subscription + buyer platform fee are the platform's only revenue, collected via Razorpay; food goes buyer → kitchen directly (UPI/pickup). Payout batches / Route stubs retired for home-food orders.
6. **Order lifecycle** → single state machine, seller-only OTP, `completed_at`, acceptance window with auto-refund.
7. **Contact** → anonymous per-order threads.
8. **FSSAI assistant** → Form A framing, eligibility, Aadhaar masking, reminders, expiry enforcement, funnel.
9. **Launch kit** → `/join/[code]`, share panel, seller checklist, legal pages.
10. **UI + tests + docs.**
