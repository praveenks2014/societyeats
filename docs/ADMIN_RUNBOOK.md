# Admin runbook

1. **First login:** sign in with the one-time password printed by `npm run db:bootstrap`, change it, then enrol two-factor (authenticator app) and save the recovery codes.
2. **Approve a kitchen:** `/admin/sellers` — check membership, PAN, the ₹1 UPI check score, FSSAI status, photos and dishes. A low name-match score only flags; you decide.
3. **Payment disputes:** open the order, read both sides, and resolve as "paid" or "unpaid". Sensitive actions ask for a fresh 2FA code.
4. **Settings:** `/admin/settings` — fees, caps, timers, GST mode. Changes apply to new orders only; existing orders keep their snapshot.
5. **Cron:** `POST /api/cron/run` every 5 minutes with the cron secret. The admin banner appears after 15 minutes of silence. `/api/health` reports `cronAgeMinutes`.
6. **Backups:** `npm run db:backup` (needs `pg_dump`). Keep copies off-box.
7. **Breach:** revoke sessions, rotate `SESSION_SECRET`/`ENCRYPTION_KEY`, note what was exposed, and notify users and CERT-In within the legal windows with counsel.
