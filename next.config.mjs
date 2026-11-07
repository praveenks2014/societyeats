/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    // Dev needs eval/websockets for HMR, so the strict set applies to production builds only.
    return process.env.NODE_ENV === 'production' ? [{ source: '/:path*', headers: securityHeaders }] : [];
  },
  // Native/WASM DB drivers must stay in node_modules, not be bundled.
  serverExternalPackages: ['@electric-sql/pglite', 'postgres', 'sharp', 'web-push'],
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
];

export default nextConfig;
