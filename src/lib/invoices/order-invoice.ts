import { eq, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { invoiceCounters, orders } from '@/lib/db/schema';
import { fyLabel } from '@/lib/orders/caps';
import { BRAND } from '@/config/brand';

type Db = Awaited<ReturnType<typeof getDb>>;

export function formatInvoiceNumber(fy: string, serial: number): string {
  return `${BRAND.invoicePrefix}/${fy}/${String(serial).padStart(6, '0')}`;
}

/**
 * Issues the platform-fee invoice number for an order, exactly once.
 * Sequential per financial year and gap-free: the counter row is bumped in the same transaction that stamps the
 * order, under the order row lock, so concurrent callers get distinct consecutive numbers and a failure rolls the
 * number back. Idempotent: an order that already has a number keeps it.
 */
export async function ensureInvoiceNumber(orderId: number, now: Date = new Date(), db?: Db): Promise<string> {
  const d = db ?? (await getDb());
  return d.transaction(async (tx) => {
    const locked = await tx.execute(sql`select invoice_number from orders where id = ${orderId} for update`);
    const row = (locked as unknown as { rows?: { invoice_number: string | null }[] }).rows?.[0] ?? (locked as unknown as { invoice_number: string | null }[])[0];
    if (!row) throw new Error('Order not found');
    if (row.invoice_number) return row.invoice_number;
    const fy = fyLabel(now);
    const [c] = await tx
      .insert(invoiceCounters)
      .values({ fy, last: 1 })
      .onConflictDoUpdate({ target: invoiceCounters.fy, set: { last: sql`${invoiceCounters.last} + 1` } })
      .returning({ last: invoiceCounters.last });
    const number = formatInvoiceNumber(fy, c.last);
    await tx.update(orders).set({ invoiceNumber: number, invoiceIssuedAt: now }).where(eq(orders.id, orderId));
    return number;
  });
}

/** Whether the platform earned (kept) a fee on this order, so a tax invoice is due. */
export function invoiceDue(o: { onlineChargeInPaise: number; feeRefundedInPaise: number; status: string }): boolean {
  if (o.onlineChargeInPaise <= 0) return false;
  if (o.feeRefundedInPaise >= o.onlineChargeInPaise) return false; // fully refunded: nothing was earned
  return ['completed', 'delivered', 'picked_up', 'closed_unpaid', 'cancelled_by_buyer', 'cancelled_buyer_unpaid', 'no_show_buyer', 'cancelled', 'cancelled_by_seller', 'cancelled_auto', 'expired', 'refund_pending'].includes(o.status);
}
