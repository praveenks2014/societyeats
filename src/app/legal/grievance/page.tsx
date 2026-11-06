import { BRAND } from '@/config/brand';

export default function GrievancePage() {
  return (
    <>
      <h1>Grievance redressal</h1>
      <p>If something went wrong, tell us. Open the order and tap “Report an issue”, or write to the grievance officer named in the footer of every page.</p>
      <h2>What happens next</h2>
      <ul>
        <li>We acknowledge your complaint within the acknowledgement time set by {BRAND.appName} (default 48 hours).</li>
        <li>We aim to resolve it within the resolution time set by {BRAND.appName} (default 15 days) and tell you the outcome.</li>
        <li>Complaints about food safety can also be raised with the FSSAI (Food Safety Connect) and the National Consumer Helpline (1915).</li>
      </ul>
    </>
  );
}
