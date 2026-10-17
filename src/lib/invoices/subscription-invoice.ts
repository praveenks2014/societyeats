import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { BRAND } from '@/config/brand';
import { formatIST } from '@/lib/time';
import { splitGst } from '@/lib/money';

export type InvoiceInput = {
  invoiceNo: string;
  issuedAt: Date;
  seller: { kitchenName: string; ownerName: string; society: string | null };
  plan: { name: string; months: number; startsAt: Date | null; endsAt: Date | null };
  basePaise: number;
  gstPaise: number;
  gstBps: number;
  totalPaise: number;
  razorpayPaymentId: string | null;
  platform: { legalName: string; gstin: string; address: string };
};

const inr = (paise: number) => `Rs ${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function invoiceNumber(subId: number, paidAt: Date): string {
  const y = paidAt.getUTCFullYear();
  return `PP-S-${y}-${String(subId).padStart(5, '0')}`;
}

/** GST-ready (when the platform has a GSTIN) or plain receipt PDF for a subscription payment. */
export async function buildSubscriptionInvoice(i: InvoiceInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const green = rgb(0.118, 0.302, 0.169);
  const ink = rgb(0.13, 0.12, 0.11);
  const faint = rgb(0.5, 0.48, 0.44);
  const hasGst = i.gstBps > 0 && !!i.platform.gstin && !i.platform.gstin.startsWith('GSTIN-');

  let y = 790;
  const text = (t: string, x: number, size = 10, f = font, color = ink) => page.drawText(t, { x, y, size, font: f, color });
  text(BRAND.appName, 50, 22, bold, green);
  y -= 18;
  text(i.platform.legalName, 50, 10, font, faint);
  y -= 13;
  text(i.platform.address, 50, 9, font, faint);
  y -= 13;
  text(hasGst ? `GSTIN: ${i.platform.gstin}` : 'GST: not registered', 50, 9, font, faint);

  y = 790;
  text(hasGst ? 'TAX INVOICE' : 'RECEIPT', 400, 16, bold, ink);
  y -= 18;
  text(`No: ${i.invoiceNo}`, 400, 10);
  y -= 14;
  text(`Date: ${formatIST(i.issuedAt)}`, 400, 10);

  y = 700;
  text('Billed to', 50, 9, font, faint);
  y -= 14;
  text(i.seller.kitchenName, 50, 12, bold);
  y -= 14;
  text(`${i.seller.ownerName}${i.seller.society ? ` · ${i.seller.society}` : ''}`, 50, 10);

  y = 630;
  page.drawLine({ start: { x: 50, y: y + 18 }, end: { x: 545, y: y + 18 }, thickness: 0.6, color: faint });
  text('Description', 50, 9, bold);
  text('Amount', 470, 9, bold);
  y -= 20;
  text(`Kitchen listing subscription — ${i.plan.name} (${i.plan.months} month${i.plan.months === 1 ? '' : 's'})`, 50, 10);
  text(inr(i.basePaise), 470, 10);
  y -= 14;
  if (i.plan.startsAt && i.plan.endsAt) text(`Period: ${formatIST(i.plan.startsAt)} to ${formatIST(i.plan.endsAt)}`, 50, 9, font, faint);
  y -= 24;
  if (hasGst) {
    const { cgst, sgst } = splitGst(i.gstPaise);
    text(`CGST (${i.gstBps / 200}%)`, 330, 10);
    text(inr(cgst), 470, 10);
    y -= 14;
    text(`SGST (${i.gstBps / 200}%)`, 330, 10);
    text(inr(sgst), 470, 10);
    y -= 14;
  }
  page.drawLine({ start: { x: 330, y: y + 10 }, end: { x: 545, y: y + 10 }, thickness: 0.6, color: faint });
  text('Total paid', 330, 11, bold);
  text(inr(i.totalPaise), 470, 11, bold);
  y -= 28;
  if (i.razorpayPaymentId) text(`Paid online via Razorpay · ref ${i.razorpayPaymentId}`, 50, 9, font, faint);
  else text('Complimentary / admin-granted — no payment taken', 50, 9, font, faint);
  y -= 40;
  text('This is the platform’s own service charge for listing your kitchen. Food payments from buyers go directly to you', 50, 8, font, faint);
  y -= 11;
  text('and are not part of this invoice. Draft — to be reviewed by a lawyer/CA before launch.', 50, 8, font, faint);
  return pdf.save();
}
