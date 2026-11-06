/**
 * Warms the Next dev server (Turbopack compiles routes on first request, and a first compile while a browser page is
 * open makes dev reload that page mid-test). Plain HTTP GETs compile every route the journeys use before any browser opens.
 */
const PAGES = [
  '/', '/login', '/register', '/join/E2E-ONE', '/forgot-password', '/verify-email', '/change-password', '/auth/2fa', '/account', '/checkout', '/cart', '/orders', '/orders/1', '/orders/1/invoice',
  '/dish/1', '/kitchen/1', '/legal/terms', '/legal/privacy', '/legal/refunds', '/legal/kitchen-terms', '/legal/food-safety', '/legal/grievance',
  '/seller', '/seller/onboarding', '/seller/payment-details', '/seller/compliance', '/seller/listings', '/seller/orders', '/seller/subscription', '/seller/inbox', '/seller/earnings', '/seller/fulfillment',
  '/admin', '/admin/kitchens', '/admin/kitchens/requests', '/admin/kitchens/1', '/admin/dishes/review', '/admin/settings', '/admin/societies', '/admin/users', '/admin/orders', '/admin/disputes', '/admin/inbox', '/admin/revenue', '/admin/complaints', '/admin/refunds',
  '/fssai/1/summary',
  '/api/health', '/api/listings', '/api/auth/me', '/api/orders', '/api/orders/1', '/api/quote?sellerId=1', '/api/seller/orders', '/api/seller/profile', '/api/seller/payment-details',
];

export default async function globalSetup() {
  const base = 'http://localhost:3100';
  for (const p of PAGES) {
    try {
      await fetch(base + p, { redirect: 'manual' });
    } catch {
      /* a route that errors without a session is fine — it is compiled now */
    }
  }
}
