import { and, asc, desc, eq, gte, isNotNull, lt } from 'drizzle-orm';
import { ApiError } from '@/lib/api';
import { getDb } from '@/lib/db';
import { getPlatformSettings } from '@/lib/db/platform';
import { auditLog, consents, orders, sellerProfiles, users } from '@/lib/db/schema';
import { splitGst } from '@/lib/money';
import { toCsv } from '@/lib/orders/earnings';
import { istDateString } from '@/lib/time';

export const EXPORT_KINDS = ['fee_invoices', 'food_gst', 'consents', 'audit_log', 'orders'] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];

const rupees = (p: number) => (p / 100).toFixed(2);
const day = (d: Date | null | undefined) => (d ? istDateString(d) : '');

/** [from, to) in IST days: `from` inclusive 00:00, `to` exclusive 00:00 of the day after the last chosen day. */
export function parseRange(from?: string | null, to?: string | null, now: Date = new Date()): { from: Date; to: Date } {
  const ok = (s?: string | null) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const start = ok(from) ? new Date(`${from}T00:00:00+05:30`) : new Date(now.getTime() - 31 * 86_400_000);
  const end = ok(to) ? new Date(new Date(`${to}T00:00:00+05:30`).getTime() + 86_400_000) : new Date(now.getTime() + 86_400_000);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) throw new ApiError(400, 'Choose a valid date range');
  if (end.getTime() - start.getTime() > 400 * 86_400_000) throw new ApiError(400, 'Choose a range of at most 13 months');
  return { from: start, to: end };
}

/** CSV for one of the compliance / finance exports. The route adds the fresh-2FA check and the audit-log row. */
export async function buildExport(kind: ExportKind, range: { from: Date; to: Date }): Promise<string> {
  const db = await getDb();
  const settings = await getPlatformSettings();
  switch (kind) {
    case 'fee_invoices': {
      const rows = await db.select({ o: orders, buyer: users.name }).from(orders).innerJoin(users, eq(users.id, orders.buyerId)).where(and(isNotNull(orders.invoiceNumber), gte(orders.invoiceIssuedAt, range.from), lt(orders.invoiceIssuedAt, range.to))).orderBy(asc(orders.invoiceNumber));
      return toCsv([
        ['Invoice number', 'Invoice date (IST)', 'Order', 'Recipient', 'Supplier GSTIN', 'GST mode at booking', 'Taxable value (INR)', 'CGST (INR)', 'SGST (INR)', 'Total (INR)', 'Fee refunded (INR)'],
        ...rows.map(({ o, buyer }) => {
          const g = splitGst(o.platformFeeGstInPaise);
          return [o.invoiceNumber, day(o.invoiceIssuedAt), o.id, buyer, settings.platformGstin || '', o.gstModeSnapshot, rupees(o.platformFeeInPaise), rupees(g.cgst), rupees(g.sgst), rupees(o.platformFeeInPaise + o.platformFeeGstInPaise), rupees(o.feeRefundedInPaise)];
        }),
      ]);
    }
    case 'food_gst': {
      // CGST Sec 9(5): food GST the platform collected and pays on the kitchens' behalf (registered_eco_9_5 orders only).
      const rows = await db.select({ o: orders, kitchen: sellerProfiles.kitchenName }).from(orders).leftJoin(sellerProfiles, eq(sellerProfiles.userId, orders.sellerId)).where(and(eq(orders.gstModeSnapshot, 'registered_eco_9_5'), gte(orders.completedAt, range.from), lt(orders.completedAt, range.to))).orderBy(asc(orders.completedAt));
      return toCsv([
        ['Order', 'Completed (IST date)', 'Kitchen', 'Food value (INR)', 'Rate (%)', 'GST collected under Sec 9(5) (INR)', 'CGST (INR)', 'SGST (INR)'],
        ...rows.filter(({ o }) => o.gstInPaise > 0).map(({ o, kitchen }) => {
          const g = splitGst(o.gstInPaise);
          return [o.id, day(o.completedAt), kitchen ?? '', rupees(o.foodTotalInPaise), (o.ecoBpsSnapshot / 100).toString(), rupees(o.gstInPaise), rupees(g.cgst), rupees(g.sgst)];
        }),
      ]);
    }
    case 'consents': {
      const rows = await db.select().from(consents).where(and(gte(consents.acceptedAt, range.from), lt(consents.acceptedAt, range.to))).orderBy(asc(consents.acceptedAt));
      return toCsv([['User id', 'Kind', 'Version', 'Accepted (UTC)', 'IP'], ...rows.map((c) => [c.userId, c.kind, c.version, c.acceptedAt.toISOString(), c.ip ?? ''])]);
    }
    case 'audit_log': {
      const rows = await db.select({ a: auditLog, actor: users.name }).from(auditLog).leftJoin(users, eq(users.id, auditLog.actorId)).where(and(gte(auditLog.createdAt, range.from), lt(auditLog.createdAt, range.to))).orderBy(asc(auditLog.createdAt));
      return toCsv([['Id', 'At (UTC)', 'Actor id', 'Actor', 'Action', 'Target type', 'Target', 'Details'], ...rows.map(({ a, actor }) => [a.id, a.createdAt.toISOString(), a.actorId ?? '', actor ?? 'system', a.action, a.targetType ?? '', a.targetId ?? '', a.meta ? JSON.stringify(a.meta) : ''])]);
    }
    case 'orders': {
      const rows = await db.select().from(orders).where(and(eq(orders.type, 'home_delivery'), gte(orders.createdAt, range.from), lt(orders.createdAt, range.to))).orderBy(desc(orders.createdAt));
      return toCsv([
        ['Order', 'Created (IST date)', 'Buyer id', 'Kitchen id', 'Status', 'Fulfilment', 'Food (INR)', 'Platform fee (INR)', 'Fee GST (INR)', 'Food GST 9(5) (INR)', 'Credit applied (INR)', 'Fee refunded (INR)', 'Credit issued (INR)', 'Invoice'],
        ...rows.map((o) => [o.id, day(o.createdAt), o.buyerId, o.sellerId ?? '', o.status, o.fulfillmentType, rupees(o.foodTotalInPaise), rupees(o.platformFeeInPaise), rupees(o.platformFeeGstInPaise), rupees(o.gstInPaise), rupees(o.referralCreditAppliedInPaise), rupees(o.feeRefundedInPaise), rupees(o.creditIssuedInPaise), o.invoiceNumber ?? '']),
      ]);
    }
  }
}
