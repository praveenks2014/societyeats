import type { Metadata, Viewport } from 'next';
import { Bricolage_Grotesque, Inter } from 'next/font/google';
import './globals.css';
import { BRAND } from '@/lib/config';
import { getSession } from '@/lib/auth';
import { Providers } from '@/components/providers';
import { Header } from '@/components/header';
import { SwRegister } from '@/components/sw-register';

const display = Bricolage_Grotesque({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
});

const body = Inter({
  subsets: ['latin'],
  variable: '--font-body',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: `${BRAND.name} — ${BRAND.tagline}`,
    template: `%s · ${BRAND.name}`,
  },
  description: BRAND.shortPitch,
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icon.svg', apple: '/icon.svg' },
  appleWebApp: { capable: true, title: BRAND.name, statusBarStyle: 'default' },
};

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
          <main className="mx-auto w-full max-w-5xl px-4 pb-28 sm:px-6">{children}</main>
          <SwRegister />
        </Providers>
      </body>
    </html>
  );
}
