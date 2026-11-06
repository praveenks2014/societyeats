# Compliance register (pilot)

> Status: **working draft for counsel review.** It records what the app does, not legal advice. "Owner" is the person who must confirm. Rules marked ⚠ need a lawyer or CA to confirm before go-live.

| # | Obligation | Source | How the app meets it | Owner | Status |
|---|---|---|---|---|---|
| 1 | Grievance officer named, contact shown | Consumer Protection (E-Commerce) Rules 2020, r.4(5) | `/legal/grievance` and footer show the officer from settings; `/admin/go-live` blocks live mode until set | Founder | Needs name |
| 2 | Acknowledge complaints in 48 hours, resolve in one month | CP (E-Commerce) Rules 2020 r.4(5) | `grievances` table, ack due and resolve due set from `grievanceAckHours` / `grievanceResolveDays`; overdue alerts to admins; `/admin/grievances` | Admin | Built |
| 3 | Seller details, price breakdown, no hidden charges | CP (E-Commerce) Rules 2020 r.5-6 | Kitchen page shows name, FSSAI status, society; upfront price lines on dish card, dish page, cart and checkout from one `priceBreakdown()` helper | Eng | Built |
| 4 | Cancellation charges apply equally to both sides | CP (E-Commerce) Rules 2020 r.4(8) / CCPA guidance | Buyer late cancel keeps fee; seller cancel after accept refunds fee + equal credit + strike. Rules are stated on checkout and `/legal/refunds` | Founder ⚠ | Built, confirm wording |
| 5 | Disclose how ranking works | CP (E-Commerce) Rules 2020 r.5(2) | `/legal/how-ranking-works`; no paid ranking while `featuredEnabled=false`; "Sponsored" label if enabled | Eng | Built |
| 6 | No dark patterns (13 specified) | CCPA Guidelines 2023 | See `docs/DARK_PATTERNS_SELF_AUDIT.md` | Eng | Self-audited |
| 7 | Notice and consent before processing; consent versioned and withdrawable | DPDP Act 2023 s.5-6; DPDP Rules 2025 | `consents` table (kind, version, time, IP); blocking re-consent modal after a material legal change; marketing opt-in only | Eng | Built ⚠ |
| 8 | Data principal rights: access, correction, erasure, grievance, nominee | DPDP Act s.11-14 | `/api/account/export`, `/api/account/delete` (anonymise), data-request tickets via `/legal/grievance`, 30-day SLA | Eng | Built |
| 9 | Reasonable security safeguards | DPDP Act s.8(5); Rules 2025 | Nonce CSP and headers, PAN encrypted, admin 2FA, rate limits, no PII in logs, IDOR tests (see `SECURITY.md`) | Eng | Built |
| 10 | Keep processing and access logs at least 1 year | DPDP Rules 2025 | `audit_log` is never purged earlier than `accessLogMinRetentionDays` (365) | Eng | Built |
| 11 | Erase data when no longer needed | DPDP Act s.8(7) | `runRetention`: chats 180d after close, verification screenshots 180d, sign-in codes 24h | Eng | Built |
| 12 | Breach reporting to the Board and users | DPDP Act s.8(6); Rules 2025 | `docs/BREACH_RUNBOOK.md` | Founder | Written |
| 13 | Adults only (no children's data) | DPDP Act s.9 | 18+ gate at sign-up, recorded as a consent | Eng | Built |
| 14 | Dates: most data-fiduciary duties apply from **13 May 2027**; Board provisions already in force | DPDP Rules 2025 (notified 13 Nov 2025) | The pilot follows the rules early | Founder ⚠ | Confirm timeline |
| 15 | Intermediary due diligence: rules and privacy policy published, grievance officer, takedown | IT (Intermediary Guidelines) Rules 2021 r.3 | Terms, Privacy, Community Guidelines, report-a-message flow | Founder ⚠ | Built |
| 16 | Food business display of FSSAI number | FSS (Licensing & Registration) Regs; FSSAI orders | Tier badge "FSSAI registered · number" or "FSSAI applied: provisional" on kitchen, dish, cart, order, receipt | Eng | Built |
| 17 | E-commerce operator needs an FSSAI Central Licence | FSSAI e-commerce guidance | Setting `platformFssaiCentralLicenseNo`; live mode refused until set; shown in footer | Founder | Needs licence |
| 18 | Basic Registration up to ₹1.5 crore; perpetual; ₹100/year | FSSAI order of 13 Mar 2026; FSS (L&R) Amendment Regs 2026 | Assistant bands and text; "rules verified Nov 2026, check FoSCoS" | Founder ⚠ | Verified once; recheck |
| 19 | GST on the platform fee; Sec 9(5) on food if the platform is the ECO for restaurant services | CGST Act s.9(5); notifications | `gstMode` (`unregistered`, `registered_fee_only`, `registered_eco_9_5`); GST only with a GSTIN; mode must be confirmed by a CA before live | CA ⚠ | Built, needs CA |
| 20 | TDS on seller sales by an e-commerce operator | Income-tax Act 2025 s.393 (formerly s.194-O) | Per-seller FY food sales tracked; warn at ₹4 lakh, pause at ₹5 lakh (settings); admin TDS CSV | CA ⚠ | Built |
| 21 | Payments position | RBI Payment Aggregator directions | Razorpay is the merchant of record for the **platform fee only**. Food money goes buyer to kitchen by UPI or cash, never through the platform, so no aggregator licence is involved | Founder ⚠ | Design constraint, enforced by tests |
| 22 | Invoice for the platform fee | CGST rules | Sequential gap-free invoice number per financial year; two-part receipt (platform invoice + kitchen food bill) | Eng | Built |
