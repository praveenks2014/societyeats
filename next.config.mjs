/** @type {import('next').NextConfig} */
const nextConfig = {
  // Native/WASM DB drivers must stay in node_modules, not be bundled.
  serverExternalPackages: ['@electric-sql/pglite', 'postgres', 'sharp'],
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'images.unsplash.com' },
      { protocol: 'https', hostname: 'plus.unsplash.com' },
    ],
  },
};

export default nextConfig;
