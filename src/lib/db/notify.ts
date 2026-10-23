import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { notifications, users } from '@/lib/db/schema';
import { sendEmail } from '@/lib/email';
import { siteOriginSafe } from '@/lib/site-url';

/** In-app notification (bell + toast). */
export async function notify(userId: number, title: string, body?: string, href?: string): Promise<void> {
  const db = await getDb();
  await db.insert(notifications).values({ userId, title, body, href });
}

/** In-app notification plus (optionally) an email to the user's address on file. */
export async function notifyUser(
  userId: number,
  title: string,
  body: string,
  href: string,
  opts: { email?: boolean; emailKind?: string } = {},
): Promise<void> {
  await notify(userId, title, body, href);
  if (!opts.email) return;
  const db = await getDb();
  const [u] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId));
  if (!u?.email) return;
  await sendEmail({
    userId,
    to: u.email,
    kind: opts.emailKind ?? 'notification',
    subject: title.replace(/[\u{1F300}-\u{1FAFF}☀-➿]/gu, '').trim(),
    text: `${body}\n\n${await siteOriginSafe()}${href}`,
  });
}
