import { notFound } from 'next/navigation';
import { Probe } from './probe';

export const dynamic = 'force-dynamic';

/** E2E only (E2E=true, never in production): a button that runs the app's real `launchRazorpay`, so the CSP test can stub checkout.razorpay.com. */
export default function RazorpayProbePage() {
  if (process.env.NODE_ENV === 'production' || process.env.E2E !== 'true') notFound();
  return <Probe />;
}
