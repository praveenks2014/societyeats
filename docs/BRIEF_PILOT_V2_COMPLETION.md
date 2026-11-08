# Kootu Pilot v2: completion brief (condensed copy; founder: Praveen Kumar S, 7 Nov 2026)

Finish every open Pilot v2 item on branch `pilot-v2` (PR #3 → main). Do not stop to ask questions: choose the option safest for buyers and the law and record it in DECISIONS.md under `## Pilot v2: completion run`. Timebox a stuck item to 45 min, note it in PROGRESS.md, move on. Commit and push per item group; run typecheck, lint and unit tests before each push; Playwright at the end of each phase. Ground rules: mock-first adapters, integer paise, idempotent money, platform never touches food money, every number an admin setting, UTC stored/IST shown, mobile-first 390px, regression test per bug, never weaken tests.

## Fixed decisions
- Seller declines a booked order: full fee refund + equal credit, no strike, counts against acceptance rate; >5 declines in 7 days nudges admins; auto no-accept = "missed" strike; add "Not taking orders today" toggle (reopens 00:00 IST).
- Plans: Monthly 199, Quarterly 499, Yearly 1799, Founding 90 days as `waived` row.
- CSP: per-request nonce from src/proxy.ts, `script-src 'self' 'nonce-…' 'strict-dynamic' https://checkout.razorpay.com`, style-src unsafe-inline, report-to + /api/csp-report; zero CSP violations in Playwright.
- UPI provider at launch `razorpay_checkout_vpa`; guard refuses `mock` when MOCK_MODE=false.
- Live-mode inputs not available: build `/admin/go-live` checklist sharing one function with the live guard.
- Legal docs have review status draft/reviewed; draft label until an admin marks reviewed (re-auth + audit).
- Notifications: Resend email; web push VAPID (`npm run vapid:generate`); SMS/WhatsApp mock adapters only.
- ADMIN_EMAILS=praveenece.mit@gmail.com,rsaralipriya@gmail.com. Storage: Replit Object Storage; /api/health must be 200 with a mock/in-memory adapter in smoke test.

## Items
Phase A: A1 FSSAI admin queue + badges + coming soon + footer licence; A2 dish rules + prohibited + priceBreakdown(); A3 seller earnings; A4 TDS CSV; A5 invoices (two-part, gap-free numbering); A6 plan UI + admin plans; A7 pause toggle.
Phase B: B1 `<Disclaimer id>` (18 texts); B2 versioned legal docs + re-consent; B3 kitchen terms; B4 COMPLIANCE/DARK_PATTERNS/BREACH docs; B5 retention jobs; B6 /admin/go-live.
Phase C: chat SSE+polling, 48h window, images, quick replies, PII filter, report/block, admin logged read.
Phase D: NotificationService, web push, event matrix, debounce.
Phase E: E1 onboarding queue; E2 disputes board; E3 grievances; E4 settings history/diff; E5 broadcast; E6 metrics + exports.
Phase F: F1 favourites; F2 menu share card; F3 pre-orders; F4 repeat/usuals; F5 quality score/Top Kitchen; F6 photo reviews; F7-F11 flag-off meal plans, featured, Plus, bulk, campaigns.
Phase G: G1 IDOR suite; G2 serialisation snapshots; G3 nonce CSP; G4 PII-free logs + request ids; G5 rate limits; G6 SECURITY.md.
Phase H: H1 unit tests; H2 e2e on desktop and mobile-390; H3 clean-room verification (npm ci, verify, build, audit, start + /api/health 200, bootstrap idempotent, seed:demo refuses prod).

## Final report must list: item checklist (✅/❌+reason), commits + PR link, PR #2 status, verification numbers, new settings, new secrets, decisions, founder go-live tasks.
