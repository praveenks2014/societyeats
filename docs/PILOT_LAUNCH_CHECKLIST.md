# PadosiPlate – pilot launch checklist

Work top to bottom. Everything up to step 6 can be done with `MOCK_MODE=true`; step 9 is the only live-money step.

- [ ] **1. Admin access.** Set `ADMIN_EMAILS` in Secrets (your e-mail, comma-separated for more). Register with that e-mail, verify it, log in, and change the one-time password when asked. Anyone else is denied `/admin`.
- [ ] **2. Real e-mail.** `EMAIL_ADAPTER=resend`, `RESEND_API_KEY`, `EMAIL_FROM` on a verified domain. Register a test account and confirm the verification mail arrives.
- [ ] **3. Societies.** `/admin/societies` → create **your society** and **the nearby society**; set pincode, centre point and whether new residents need approval. Copy each invite link (`/join/<code>`) and print the poster PDF from the share panel.
- [ ] **4. Fees and plans.** `/admin/settings`: buyer platform fee % (default 10), floor/cap, GST rate. `/admin/subscriptions`: review the plans and add a **free launch period** (a ₹0 / waived plan or a complimentary grant per kitchen) for the first kitchens.
- [ ] **5. Legal placeholders.** Enter legal entity name, GSTIN (GST is only added once a GSTIN is set), registered address, grievance officer and `platformFssaiCentralLicenseNo` in `/admin/settings`. Replace the draft legal pages with lawyer-reviewed text when you have it.
- [ ] **6. Onboard the first 5 kitchens.** Each kitchen: profile, UPI VPA, FSSAI (assistant or licence number), dishes with photos, subscription, **Submit listing request**. Review in `/admin/kitchens/requests`, message them from the inbox if photos need work, approve dishes, then approve the kitchen.
- [ ] **7. Share the join links** in the two societies' WhatsApp groups. Watch `/admin` (requests, users, complaints) daily.
- [ ] **8. Cron.** Schedule `POST /api/cron/run` with `Authorization: Bearer $CRON_SECRET` hourly (expiry and grace sweeps, unpaid-order expiry, reminders, retention purge).
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
- **Trademark search** for "PadosiPlate" before spending on branding.
- Bank account / PAN collection, kitchen payouts and platform delivery are intentionally **not** part of this phase.
