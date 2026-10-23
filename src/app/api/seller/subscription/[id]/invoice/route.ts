import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { api, ApiError } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { BRAND } from '@/config/brand';
import { getDb } from '@/lib/db';
import { getPlatformSettings } from '@/lib/db/platform';
import { kitchenSubscriptions, sellerProfiles, societies, users } from '@/lib/db/schema';
import { buildSubscriptionInvoice, invoiceNumber } from '@/lib/invoices/subscription-invoice';

export const dynamic = 'force-dynamic';

export const GET = api<{ params: { id: string } }>(async (_req, { params }) => {
  const session = await requireSession(['seller', 'admin']);
  const id = Number(params.id);
  const db = await getDb();
  const [sub] = await db.select().from(kitchenSubscriptions).where(eq(kitchenSubscriptions.id, id));
  if (!sub || (session.role !== 'admin' && sub.sellerId !== session.uid)) throw new ApiError(404, 'Invoice not found');
  if (!sub.paidAt && sub.status !== 'waived') throw new ApiError(404, 'No invoice for an unpaid period');
  const [row] = await db
    .select({ p: sellerProfiles, u: users, s: societies })
    .from(sellerProfiles)
    .innerJoin(users, eq(sellerProfiles.userId, users.id))
    .leftJoin(societies, eq(users.societyId, societies.id))
    .where(eq(sellerProfiles.userId, sub.sellerId));
  const settings = await getPlatformSettings();
  const issuedAt = sub.paidAt ?? sub.createdAt;
  const pdf = await buildSubscriptionInvoice({
    invoiceNo: invoiceNumber(sub.id, issuedAt),
    issuedAt,
    seller: { kitchenName: row?.p.kitchenName ?? 'Kitchen', ownerName: row?.u.name ?? '', society: row?.s?.name ?? null },
    plan: { name: sub.planNameSnapshot ?? 'Subscription', months: sub.durationMonthsSnapshot, startsAt: sub.startsAt, endsAt: sub.endsAt },
    basePaise: sub.pricePaiseSnapshot,
    gstPaise: sub.gstPaise,
    gstBps: sub.gstBpsSnapshot,
    totalPaise: sub.pricePaiseSnapshot + sub.gstPaise,
    razorpayPaymentId: sub.razorpayPaymentId,
    platform: { legalName: settings.legalEntityName || BRAND.legalEntityName, gstin: settings.platformGstin || BRAND.gstin, address: settings.registeredAddress || BRAND.registeredAddress },
  });
  return new NextResponse(new Uint8Array(pdf), {
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${invoiceNumber(sub.id, issuedAt)}.pdf"`, 'Cache-Control': 'private, no-store' },
  });
});
