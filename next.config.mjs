/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    // Dev needs eval/websockets for HMR, so the strict set applies to production builds only.
    return process.env.NODE_ENV === 'production' ? [{ source: '/:path*', headers: securityHeaders }] : [];
  },
  // Native/WASM DB drivers must stay in node_modules, not be bundled.
  serverExternalPackages: ['@electric-sql/pglite', 'postgres', 'sharp'],
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'images.unsplash.com' },
      { protocol: 'https', hostname: 'plus.unsplash.com' },
    ],
  },
};

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self), payment=(self)' },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
  {
    key: 'Content-Security-Policy',
    // Next injects inline bootstrap scripts, so script-src keeps 'unsafe-inline' (a per-request nonce is listed as follow-up in SECURITY.md).
    value: "default-src 'self'; script-src 'self' 'unsafe-inline' https://checkout.razorpay.com; frame-src https://api.razorpay.com https://checkout.razorpay.com; connect-src 'self' https://api.razorpay.com https://lumberjack.razorpay.com; img-src 'self' data: blob: https:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  },
];

export default nextConfig;
