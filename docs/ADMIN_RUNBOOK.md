# Admin runbook

1. **First login:** sign in with the one-time password printed by `npm run db:bootstrap`, change it, then enrol two-factor (authenticator app) and save the recovery codes.
2. **Approve a kitchen:** `/admin/sellers` — check membership, PAN, the ₹1 UPI check score, FSSAI status, photos and dishes. A low name-match score only flags; you decide.
3. **Payment disputes:** open the order, read both sides, and resolve as "paid" or "unpaid". Sensitive actions ask for a fresh 2FA code.
4. **Settings:** `/admin/settings` — fees, caps, timers, GST mode. Changes apply to new orders only; existing orders keep their snapshot.
5. **Cron:** `POST /api/cron/run` every 5 minutes with the cron secret. The admin banner appears after 15 minutes of silence. `/api/health` reports `cronAgeMinutes`.
6. **Backups:** automatic, daily after 03:00 IST, to Object Storage `backups/` (newest 14 daily and 8 weekly kept; see Admin → Go-live → Database backups, where **Run backup now** takes one on demand). `npm run db:backup` is only a manual `pg_dump`. Do the restore drill below before launch.
7. **Breach:** revoke sessions, rotate `SESSION_SECRET`/`ENCRYPTION_KEY`, note what was exposed, and notify users and CERT-In within the legal windows with counsel.

## Pilot v2 additions

- **Go-live** (`/admin/go-live`): what still blocks going live, with one-click fixes for settings.
- **Settings** need a reason on every save and keep a history you can restore from.
- **Chat**: you can read an order's thread only from the order page with a reason and a fresh 2FA check; each read is audited. Reports open a grievance.
- **Grievances** (`/admin/grievances`): acknowledged automatically; tickets older than 48 hours raise a banner and alert admins.
- **Optional features** (Settings → Feature flags, all off): meal plans, Sponsored placement and campaigns (`/admin/growth`), Kootu Plus, bulk orders. Sponsored kitchens are always labelled and never mixed into ranking.
- **Security checks you can trust**: CSP violations are logged as `csp.violation`; every 500 shows a reference code the user can quote.

## Restore drill (do it once before launch, and after any big change)

A backup you have never restored is a hope, not a backup. The drill restores the newest backup into a **new, empty** database and checks it.

1. In Replit open the **PostgreSQL** tool and create a **new** database (do not touch the live one). Note its connection string.
2. In the Replit shell run, with that connection string and the live Object Storage bucket (the same Secrets as the app):
   `DATABASE_URL=<new database url> npm run db:restore`
   With no argument it uses the newest backup in `backups/index.json`; to choose one: `npm run db:restore -- backups/kootu-<time>.jsonl.gz` (keys are listed by `GET /api/admin/backup` and in the Object Storage bucket).
3. The script applies the migrations to the empty database, restores every table in one transaction, checks each table's row count against the backup's manifest and prints the counts per table. It **refuses** if any app table already has rows, or if the backup was taken at a different migration level (restore with the same app version).
4. Verify: start the app against the new database (set `DATABASE_URL` to it in a test deployment or locally), open `/api/health` (200, `db: ok`), log in as an admin (password and two-factor are in the backup), open `/admin` and check the order, kitchen and user counts and the newest order against what you expect.
5. To go back to production on the restored database: put its URL in the live Secrets as `DATABASE_URL` and redeploy. Uploaded files (kitchen photos, certificates) live in Object Storage and are not part of the database backup, so they are still there.
6. A `.sql.gz` backup (taken when `pg_dump` was available) restores into an empty database with `npm run db:restore -- <key>` too (it needs `psql`), or manually: `gunzip -c file.sql.gz | psql "$DATABASE_URL"`.
7. Delete the drill database when you are done.

Failure alerts: if the nightly backup fails, both admins get an in-app and e-mail alert once; open Go-live → Database backups for the error and press **Run backup now** after fixing it.
