import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BRAND } from '@/config/brand';
import { societyForInvite } from '@/lib/join';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: { code: string } }): Promise<Metadata> {
  const r = await societyForInvite(params.code);
  if (!r) return {};
  const title = `Join ${BRAND.appName} in ${r.society.name}`;
  const description = `${BRAND.tagline}. ${r.liveKitchens} kitchen${r.liveKitchens === 1 ? '' : 's'} cooking in ${r.society.name}.`;
  return { title, description, openGraph: { title, description, type: 'website' }, twitter: { card: 'summary_large_image', title, description } };
}

export default async function JoinPage({ params }: { params: { code: string } }) {
  const r = await societyForInvite(params.code);
  if (!r) notFound();
  const code = encodeURIComponent(r.society.inviteCode!);
  return (
    <div className="mx-auto max-w-md pt-10 text-center">
      <div className="text-5xl" aria-hidden>🍛</div>
      <div className="eyebrow mt-4">{BRAND.appName.toUpperCase()} · {BRAND.tagline.toUpperCase()}</div>
      <h1 className="mt-2 text-3xl font-bold" data-testid="join-society">{r.society.name}</h1>
      <p className="mt-2 text-ink-soft">
        {r.liveKitchens > 0 ? <><strong data-testid="live-kitchens">{r.liveKitchens}</strong> neighbour kitchen{r.liveKitchens === 1 ? ' is' : 's are'} cooking right now.</> : 'Kitchens are joining — be one of the first.'}
      </p>
      <div className="mt-8 grid gap-3">
        <Link href={`/register?code=${code}`} className="flex min-h-[52px] items-center justify-center rounded-xl bg-turmeric px-6 text-base font-bold text-ink shadow-card" data-testid="join-resident">
          Join as resident
        </Link>
        <Link href={`/register?code=${code}&as=seller`} className="flex min-h-[52px] items-center justify-center rounded-xl border-2 border-leaf px-6 text-base font-bold text-leaf" data-testid="join-kitchen">
          List your kitchen
        </Link>
        <Link href="/login" className="inline-flex min-h-[44px] items-center text-sm font-semibold text-leaf underline">Already have an account? Log in</Link>
      </div>
      <p className="mt-8 text-xs text-ink-faint">You pay kitchens directly (UPI or at pickup). {BRAND.appName} charges only a small platform fee.</p>
    </div>
  );
}
