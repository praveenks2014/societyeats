import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default function OfflinePage() {
  return (
    <div className="flex flex-col items-center gap-4 py-24 text-center">
      <div className="text-6xl" aria-hidden>
        📡
      </div>
      <h1 className="text-2xl font-bold">You&apos;re offline</h1>
      <p className="max-w-sm text-sm text-ink-soft">
        The kitchens are still cooking — reconnect to see what&apos;s fresh near you. Pages
        you&apos;ve visited may still work from cache.
      </p>
      <Link href="/" className="rounded-xl bg-turmeric px-5 py-2.5 text-sm font-bold text-ink">
        Try again
      </Link>
    </div>
  );
}
