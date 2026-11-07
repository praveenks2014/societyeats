import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { MealPlans } from '@/components/meal-plans';

export const dynamic = 'force-dynamic';

export default async function MyPlansPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/plans');
  return (
    <div className="mx-auto max-w-lg pt-6">
      <h1 className="text-2xl font-bold">My meal plans</h1>
      <MealPlans />
    </div>
  );
}
