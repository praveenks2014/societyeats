/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Native/WASM DB drivers must stay in node_modules, not be bundled.
    serverComponentsExternalPackages: ['@electric-sql/pglite', 'postgres'],
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'images.unsplash.com' },
      { protocol: 'https', hostname: 'plus.unsplash.com' },
    ],
  },
};

export default nextConfig;
