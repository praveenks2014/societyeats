# Personal-data breach runbook

Applies to any loss, leak or unauthorised access of personal data (accounts, orders, chats, PAN, UPI IDs, uploaded documents).

## Roles
- **Incident lead:** founder (Praveen Kumar S). **Backup:** second admin.
- **Engineering:** whoever is on call. **Counsel / CA:** engaged as needed.

## Steps
1. **Contain (first hour).** Revoke all sessions (`DELETE FROM sessions`), rotate `JWT_SECRET`, `ENCRYPTION_KEY`, Razorpay and Resend keys as relevant, disable the affected route or feature, and take a database snapshot (`npm run db:backup`). Do not delete logs.
2. **Preserve evidence.** Save logs with the request ids, the audit log export, the deployment ids and timestamps. Note who accessed what and when.
3. **Assess.** What data, how many people, since when, is it still exposed, any financial or safety risk? Record in the incident log.
4. **Notify without delay.**
   - **Affected users:** plain-language message by email and in-app: what happened, what data, what risk, what we did, what they should do, and who to contact.
   - **Data Protection Board of India:** intimation without delay, then a detailed report **within 72 hours** (nature, extent, timing, likely impact, mitigation, who was told). Confirm the current portal and format with counsel.
   - **CERT-In:** report cyber incidents within 6 hours of noticing, as the 2022 directions require. ⚠ confirm with counsel.
   - **Razorpay / banks** if payment data or fraud is involved.
5. **Fix and verify.** Patch the root cause, add a regression test, and re-run the IDOR and serialisation suites.
6. **Review (within 7 days).** Write what happened, the timeline, the cause, and what changes. Update `SECURITY.md` and this runbook.

## Templates
**User email:** "On <date> we found that <what happened>. The data involved was <list>. We have <actions>. We recommend you <steps, e.g. change your password>. We are sorry. Questions: <support email / officer>."

**Board report headings:** 1. Nature and extent. 2. Timing and location. 3. Likely impact. 4. Mitigation taken. 5. Findings on the cause. 6. Steps to prevent recurrence. 7. Notice given to users.
