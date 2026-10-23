import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import './globals.css';
import { BRAND } from '@/config/brand';
import { getSession } from '@/lib/auth';
import { siteOrigin } from '@/lib/site-url';
import { Providers } from '@/components/providers';
import { Header } from '@/components/header';
import { VerifyBanner } from '@/components/verify-banner';
import { SwRegister } from '@/components/sw-register';

// Self-hosted variable fonts (no Google Fonts request at build or run time).
const display = localFont({
  src: '../fonts/bricolage-grotesque-latin-wght-normal.woff2',
  variable: '--font-display',
  display: 'swap',
  weight: '200 800',
});

const body = localFont({
  src: '../fonts/inter-latin-wght-normal.woff2',
  variable: '--font-body',
  display: 'swap',
  weight: '100 900',
});

// A function (not a static object) so metadataBase can be derived from the
// live request's host — see src/lib/site-url.ts. Needed for Phase 6's
// per-listing/per-kitchen Open Graph images (DECISIONS.md #87+) to resolve
// to an absolute, deployment-correct URL instead of Next's "localhost:3000"
// fallback.
export async function generateMetadata(): Promise<Metadata> {
  let metadataBase: URL | undefined;
  try {
    metadataBase = new URL(await siteOrigin());
  } catch {
    metadataBase = undefined;
  }
  return {
    metadataBase,
    title: {
      default: `${BRAND.appName} — ${BRAND.tagline}`,
      template: `%s · ${BRAND.appName}`,
    },
    description: BRAND.shortPitch,
    manifest: '/manifest.webmanifest',
    icons: { icon: '/icon.svg', apple: '/apple-touch-icon.png' },
    appleWebApp: { capable: true, title: BRAND.appName, statusBarStyle: 'default' },
  };
}

export const viewport: Viewport = {
  themeColor: '#1E4D2B',
  width: 'device-width',
  initialScale: 1,
};

export const dynamic = 'force-dynamic';

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body className="min-h-screen">
        <Providers>
          <Header session={session} />
          {session && !session.emailVerified && !session.mustChangePassword && <VerifyBanner />}
          <main className="mx-auto w-full max-w-5xl px-4 pb-28 sm:px-6">{children}</main>
          <SwRegister />
        </Providers>
      </body>
    </html>
  );
}
