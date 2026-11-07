import Link from 'next/link';
import { notFound } from 'next/navigation';
import { activeCampaign } from '@/lib/campaigns';

export const dynamic = 'force-dynamic';

export default async function CampaignPage({ params }: { params: Promise<{ slug: string }> }) {
  const c = await activeCampaign((await params).slug);
  if (!c) notFound();
  return (
    <div className="mx-auto max-w-lg pt-6" data-testid="campaign-page">
      <div className="eyebrow">{c.campaign.startsOn} → {c.campaign.endsOn}</div>
      <h1 className="mt-1 text-2xl font-bold">{c.campaign.title}</h1>
      <p className="mt-2 whitespace-pre-wrap text-sm text-ink-soft">{c.campaign.body}</p>
      <p className="mt-3 text-xs text-ink-faint">Pre-order at checkout with “Order for later”. You pay the small platform fee now and the kitchen at your door.</p>
      <ul className="mt-4 space-y-2" data-testid="campaign-kitchens">
        {c.kitchens.map((k) => (
          <li key={k.sellerId}><Link href={`/kitchen/${k.sellerId}`} className="block rounded-card border border-rice-line bg-white p-4 font-semibold">{k.kitchen}</Link></li>
        ))}
      </ul>
    </div>
  );
}
