import { and, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { orderMessages, orders } from '@/lib/db/schema';
import { registerFileAccessResolver } from '@/lib/storage/access';

let done = false;
/** Chat photos are private: the sender (owner) and the other participant of that order may view them. Admins have no standing access (they use the logged admin reader, which lists the same URLs for an order under review). */
export function registerChatFileAccess() {
  if (done) return;
  done = true;
  registerFileAccessResolver(async (session, file) => {
    if (file.purpose !== 'chat_image') return false;
    const db = await getDb();
    const [m] = await db.select({ orderId: orderMessages.orderId }).from(orderMessages).where(eq(orderMessages.imageKey, file.key));
    if (!m) return false;
    if (session.role === 'admin') return (await import('@/lib/messaging/order-thread')).adminMayRead(m.orderId);
    const [o] = await db.select({ buyerId: orders.buyerId, sellerId: orders.sellerId }).from(orders).where(and(eq(orders.id, m.orderId)));
    return !!o && (o.buyerId === session.uid || o.sellerId === session.uid);
  });
}
