# Dark patterns self-audit (CCPA Guidelines 2023, Annexure 1)

For each of the 13 specified patterns: where it could appear, and how Kootu avoids it. Re-run this list before every launch.

| # | Pattern | Screens checked | How it is avoided |
|---|---|---|---|
| 1 | False urgency | Home, dish page, checkout | No countdowns except real timers the user needs (accept window). No "only 2 left" unless the stock number is real (`availableQty`). |
| 2 | Basket sneaking | Cart, checkout | Nothing is added automatically. No donation, insurance or add-on. Credit is applied only if the user ticks it. |
| 3 | Confirm shaming | Cancel flows, opt-ins | Neutral labels: "Cancel order", "No thanks". No guilt copy. |
| 4 | Forced action | Sign-up, push prompt | Marketing, push and WhatsApp are opt-in. Push is asked only after a first order and can be declined. Sign-up needs only what the service needs. |
| 5 | Subscription trap | Plus, kitchen plans | Cancel is one tap. No auto-debit (pay each period). Renewal reminder before expiry. Plus is off in the pilot. |
| 6 | Interface interference | Checkout, legal modal | Equal-weight Accept and Decline. Fee and food price shown in the same size. Disclaimers are visible text, never hover-only. |
| 7 | Bait and switch | Dish page, checkout | Price lines are computed by one helper used on card, cart and checkout, so they cannot drift. |
| 8 | Drip pricing | Dish card to checkout | "₹X food + ₹Y platform fee" shown from the first card. GST lines shown when charged. |
| 9 | Disguised advertisement | Feed, kitchens | No paid placement. If `featuredEnabled` is turned on, it is labelled "Sponsored" and disclosed on How ranking works. |
| 10 | Nagging | Banners, push | Pilot banner dismissible per version. Chat push debounced to one per 2 minutes. Quiet hours 22:00 to 07:00. |
| 11 | Trick question | Consent, settings | Positive, unticked checkboxes ("I accept the Terms"). No double negatives. |
| 12 | SaaS billing | Kitchen subscription | Invoices per period, amounts and GST itemised, no silent renewals. |
| 13 | Rogue malware | Whole app | No third-party scripts except Razorpay checkout (allow-listed in the CSP). |

Also checked: cancellation rules are the same on both sides (documented in `docs/COMPLIANCE.md` row 4), and the fee kept after acceptance is stated on checkout before the user pays.
