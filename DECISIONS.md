# DECISIONS.md — assumptions & pragmatic choices

Every non-obvious call made while building GharSe in one session, and why.

## Stack & infrastructure

1. **PGlite dev fallback.** The spec mandates Postgres via `DATABASE_URL` (kept as the primary path, used on Replit). When the variable is unset, the app falls back to an embedded PGlite (WASM Postgres) at `./.data/pglite` with auto-migrate + auto-seed. Rationale: the build machine and fresh clones have no Postgres, and "fully clickable tonight" beats "install a database first". Same Drizzle API both ways; no native binaries either way.
2. **No middleware.ts.** Role checks live in layouts (`/seller`, `/admin`, `/restaurant`) and in every API handler via `requireSession(roles)`. Simpler than edge middleware and avoids edge-runtime DB access.
3. **Hand-rolled service worker** instead of `@ducanh2912/next-pwa`: fewer build-time moving parts, and the spec explicitly allowed it. It precaches an offline shell, uses network-first for navigations, SWR for images, and never caches `/api/*`.
4. **SVG PWA icons.** Chrome accepts SVG manifest icons; shipping raster PNGs would need an image toolchain. Swap in PNGs later if older Android install banners matter.
5. **`.replit` committed** so "Import from GitHub" runs with zero changes (dev run + autoscale deployment config).

## Product behaviour

6. **Single-vendor basket** (like Swiggy): a cart holds items from one kitchen/counter at a time; adding from another prompts "start a new basket?". Keeps delivery quotes, commission math, and seller queues coherent.
7. **Dispatch happens at "Mark ready"**, not at accept — closest to how food actually meets riders, and it makes the chaos-toggle demo a single button press.
8. **Mock tracking is clock-derived** (dispatch timestamp encoded in the mock provider order id): rider assigned <1 min, picked up 1–3 min, in transit afterwards, then "arrived — share OTP". No timers, no workers, survives serverless restarts.
9. **Delivery quotes are deterministic** in mock (distance-based, per-provider pricing personality, clamped ₹30–₹70) so the checkout preview and the charged amount always agree. The ~15% simulated failure applies to `createDelivery` only.
10. **Order cannot be delivered without the OTP**; in mock, the buyer's tracking screen hosts the simulated "rider handset" input. Mall pickups verify the OTP from the restaurant console instead.
11. **Rejecting a paid order → `refund_pending`** and the payment row flips to `refunded` immediately in mock; live mode would call Razorpay's refund API (stub noted in code).
12. **Ratings aggregate on seller profiles** (running average + count) and only home-kitchen orders affect them; mall counters keep FSSAI display but no rating field (out of scope).
13. **Buyer location is client-held** (localStorage) and sent as query params; the server re-validates the 10 km rule at quote time *and* order time from the address coordinates, so the radius cannot be spoofed by skipping the UI.
14. **FSSAI-pending grace window**: enforced lazily at browse time (no cron) — when a pending kitchen's newest application is older than `fssaiPendingMaxDays`, its listings are set inactive during the next browse query.
15. **Admin "grant" sets a 1-year expiry** from the grant date (typical minimum FSSAI validity) since the real certificate isn't parsed.

## Integrations

16. **Live API shapes are best-effort from public docs** (Porter UAT gateway, Shadowfax Flash, Borzo business API 1.6, Surepass FSSAI) and every live branch is marked `// VERIFY against partner docs when keys arrive`. None execute in MOCK_MODE.
17. **Razorpay capture is idempotent and race-safe**: the client-side signature verify handler and the webhook both funnel into `markOrderPaid`, which no-ops unless the order is still `placed`.
18. **Settlements (Razorpay Route)** are Phase 2: interface stubbed in `src/lib/payments/settlements.ts`, earnings page shows the "T+1 via Razorpay Route — coming soon" ledger note.
19. **Notifications are in-app only** (bell + 25s polling + toasts). Web push needs VAPID keys and a push service; the `notify()` helper is the single seam where push/MSG91 SMS would plug in.
20. **Uploads go to `/public/uploads`** with type/size validation; README flags the swap to object storage for production. Seeded FSSAI "documents" reference a committed placeholder SVG so the admin queue renders without uploads.

## Data & seed

21. **Society coordinates are approximate** (Nallagandla ↔ Narsingi ≈ 8.9 km apart) so cross-society browsing sits just inside the 10 km radius — deliberately, to demo distance chips both near and far. GVK One (Banjara Hills) is ~15 km from both, keeping mall counters out of home-delivery browse.
22. **Unsplash photo IDs are best-effort**; every image renders through a `FoodImage` component that falls back to a brand-styled placeholder on 404, so a dead URL never breaks the UI.
23. **Money is integer paise everywhere**; display formatting is `en-IN`.
24. **Demo login phone numbers** follow the spec's "demo accounts" intent: buyer 9999999901, seller 9999999902, restaurant 9999999903, admin 9999999904 (password `demo1234`), plus five more sellers and two more restaurant managers on 99999999xx.

## Schema extensions beyond the spec

25. Added `order_events` (timeline), `notifications`, `ratingCount` on seller profiles, `priority` + `chaosForceFail` on `provider_health`, and `titleSnapshot` on order items (order history survives listing edits). All additive.
26. `orders.status` gained `delivery_unassigned` (spec §7.3 requires the state; the enum in §5 didn't list it).
