import { getDb } from '@/lib/db';
import { notifications } from '@/lib/db/schema';

/** In-app notification (bell + toast). Push delivery is a Phase-2 swap. */
export async function notify(
  userId: number,
  title: string,
  body?: string,
  href?: string,
): Promise<void> {
  const db = await getDb();
  await db.insert(notifications).values({ userId, title, body, href });
}
