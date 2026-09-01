import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { FssaiSummaryView } from './summary-client';

export const dynamic = 'force-dynamic';

export default async function FssaiSummaryPage({ params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) redirect(`/login?next=/fssai/${params.id}/summary`);
  return <FssaiSummaryView applicationId={Number(params.id)} />;
}
