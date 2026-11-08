# Kootu – pilot launch checklist

Work top to bottom. Everything up to step 6 can be done with `MOCK_MODE=true`; step 9 is the only live-money step.

- [ ] **1. Admin access.** Set `ADMIN_EMAILS` in Secrets (your e-mail, comma-separated for more). Register with that e-mail, verify it, log in, and change the one-time password when asked. Anyone else is denied `/admin`.
- [ ] **2. Real e-mail.** `EMAIL_ADAPTER=resend`, `RESEND_API_KEY`, `EMAIL_FROM` on a verified domain. Register a test account and confirm the verification mail arrives.
- [ ] **3. Societies.** `/admin/societies` → create **your society** and **the nearby society**; set pincode, centre point and whether new residents need approval. Copy each invite link (`/join/<code>`) and print the poster PDF from the share panel.
- [ ] **4. Fees and plans.** `/admin/settings`: buyer platform fee % (default 10), floor/cap, GST rate. `/admin/subscriptions`: review the plans and add a **free launch period** (a ₹0 / waived plan or a complimentary grant per kitchen) for the first kitchens.
- [ ] **5. Legal placeholders.** Enter legal entity name, GSTIN (GST is only added once a GSTIN is set), registered address, grievance officer and `platformFssaiCentralLicenseNo` in `/admin/settings`. Replace the draft legal pages with lawyer-reviewed text when you have it.
- [ ] **6. Onboard the first 5 kitchens.** Each kitchen: profile, UPI VPA, FSSAI (assistant or licence number), dishes with photos, subscription, **Submit listing request**. Review in `/admin/kitchens/requests`, message them from the inbox if photos need work, approve dishes, then approve the kitchen.
- [ ] **7. Share the join links** in the two societies' WhatsApp groups. Watch `/admin` (requests, users, complaints) daily.
- [ ] **8. Schedule the cron job (required on Autoscale).** Autoscale has no built-in cron, so `/api/cron/run` never runs on its own. Set `CRON_SECRET` in Secrets, then schedule it every 5 minutes with cron-job.org:
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
- [ ] **9. One live-mode test.** Set `MOCK_MODE=false` with live Razorpay keys and the webhook (see README). Buy a **₹1 plan** as a test kitchen, then place a small order and pay its platform fee, reject it from the kitchen so the fee is refunded, and confirm the refund in Razorpay and `/admin/refunds`. Check `/admin/revenue`.
- [ ] **10. Monitor.** `/api/health`, Replit deployment logs (structured JSON), `/admin/revenue`, `/admin/refunds`, `/admin/complaints`.

## Known gaps before wider launch

- The platform's **own FSSAI e-commerce registration/licence** (enter its number in settings once granted).
- **GST reviewed by a CA**: Section 9(5) ECO treatment, 18% GST on the platform fee and subscriptions, TCS (GST) and TDS 194-O if food money ever flows through the platform. The pilot's invoices are guidance, not tax advice.
- **Auto-renewing subscriptions** (today a kitchen renews manually; periods stack).
- **Razorpay Route / escrow** is needed only if the platform ever collects food money — which it must not without licensing advice.
- **Lawyer-reviewed terms**, kitchen terms, privacy policy and refund policy (all marked drafts).
- **Phone OTP** login/verification (today: e-mail verification and password login).
- **WhatsApp Business relay** for order notifications (today: in-app and e-mail).
- **Trademark search** for "Kootu" before spending on branding.
- Bank account / PAN collection, kitchen payouts and platform delivery are intentionally **not** part of this phase.

## Before go-live (Pilot v2): founder's tasks

Open `/admin/go-live`: it lists every blocker and links each to the screen that fixes it. The app refuses to start with `MOCK_MODE=false` while a blocking row is open (same function). In practice:

1. **Legal review.** Have a lawyer review every document in `/admin/legal`, then mark each one *reviewed* (they ship as *draft*). Fill the grievance officer's name and email, the registered address and the GSTIN in `/admin/settings`.
2. **Platform FSSAI** e-commerce registration number in `/admin/settings`.
3. **Razorpay** keys and webhook secret (platform fees only); UPI verification provider `razorpay_checkout_vpa`. Add `RAZORPAYX_ACCOUNT_NUMBER` only if you switch to `razorpayx_rpd`.
4. **Real e-mail**: `EMAIL_ADAPTER=resend`, `RESEND_API_KEY`, `EMAIL_FROM` on a verified domain.
5. **Object Storage**: create the Replit bucket, `STORAGE_ADAPTER=replit`.
6. **Push (optional)**: `npm run vapid:generate`, then set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`.
7. **Cron**: schedule `POST /api/cron/run` every 5 minutes with `CRON_SECRET`.
8. **Admins**: both `ADMIN_EMAILS` accounts log in, change the one-time password and enrol two-factor; keep the recovery codes.
9. **Backups**: automatic and daily after 03:00 IST to Object Storage (nothing to schedule beyond the 5-minute cron). Press **Run backup now** on `/admin/go-live` once, confirm "Database backups" is green, then run the **Restore drill** in `docs/ADMIN_RUNBOOK.md` into a new empty database.
10. **GST by a CA** (see below) and a **breach drill** from `docs/BREACH_RUNBOOK.md`.

## Payments: two paths with your existing Razorpay account

**Trial with test keys** (no real money; can run while `MOCK_MODE=true`):
1. Razorpay Dashboard → switch to **Test mode** → Settings → API keys → generate keys (`rzp_test_…`).
2. Create a **test** webhook → `https://<domain>/api/webhooks/razorpay` with the events in the README; copy its secret.
3. In Secrets set `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`. Leave `MOCK_MODE=true`.
4. Run `npm run razorpay:check`. Expect "Payments mode: razorpay_test" and an order id.
5. Place an order, pay the fee with Razorpay's test UPI/cards; the amber banner "Test payments: no real money is charged." shows on checkout.

**Live**:
1. `/admin/go-live` configuration rows all green (FSSAI Central licence, GST position, legal entity, grievance officer, support contact, webhook secret, UPI provider).
2. Razorpay Dashboard → **Live mode** → live keys (`rzp_live_…`) and a **live** webhook with the same events; add the website URL to the account details.
3. Replace the three secrets with the live values, set `MOCK_MODE=false` and `EMAIL_ADAPTER=resend`, redeploy.
4. `npm run razorpay:check` (live): expect "razorpay_live".
5. Take a live ₹1 UPI check for a kitchen and a live platform fee on a real order between the two admins; refund it from `/admin/refunds` and confirm the refund webhook.
6. Your other apps on the same account must ignore events whose order notes say `app: kootu`.

## Email must really send before residents sign up

With `MOCK_MODE=true` mails land in `/admin/outbox` and are **not delivered** unless `EMAIL_ADAPTER=resend` is set. For a family trial with real residents: set `EMAIL_ADAPTER=resend`, `RESEND_API_KEY` and `EMAIL_FROM` (an address on a **domain verified in Resend**; `onboarding@resend.dev` only delivers to your own address). `/admin/go-live` → "Email delivery" must be green (red = outbox only, amber = last send failed or a test domain).

## Before the first residents see the Kootu name

1. **Domain**: register the domain, point it at the Replit deployment, set `SITE_URL` to it (https).
2. **E-mail**: verify the domain in Resend (add the DNS records), then set `EMAIL_FROM="Kootu <no-reply@mail.<your-domain>>"`. Until the domain is verified Resend only delivers to your own address.
3. **Trademark search** for "Kootu" before spending on branding: IP India (public search), classes **35** (marketplace services), **39** (delivery / transport of food), **43** (food and drink services) and **9** (software / apps). Also check the domain, app-store names and social handles.
4. **Razorpay**: add the new website URL (and the app name) to the Razorpay account's business details before taking live payments. Test orders already created on the shared account under the earlier name still reconcile (the webhook accepts both `notes.app` values).
5. **Existing database**: `npm run db:bootstrap` rewrites the earlier name in text that was seeded (version-1 disclaimers and the FSSAI walkthrough) and leaves anything an admin edited. Legal documents are edited in `/admin/legal`: use "Compare with latest seed draft" to bring a document in line.
6. **Browsers**: nothing to do. Saved carts and locations move to the new storage keys on the first visit, and the old service-worker caches are deleted on activation.
