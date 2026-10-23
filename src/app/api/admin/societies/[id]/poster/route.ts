import { eq } from 'drizzle-orm';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import QRCode from 'qrcode';
import { NextResponse } from 'next/server';
import { api, ApiError } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { BRAND } from '@/config/brand';
import { getDb } from '@/lib/db';
import { societies } from '@/lib/db/schema';
import { joinUrl } from '@/lib/society-share';

export const dynamic = 'force-dynamic';

/** Printable A4 poster with a QR code to the society's join page. */
export const GET = api<{ params: { id: string } }>(async (_req, { params }) => {
  await requireSession(['admin']);
  const db = await getDb();
  const [s] = await db.select().from(societies).where(eq(societies.id, Number(params.id)));
  if (!s || !s.inviteCode) throw new ApiError(404, 'Society not found');
  const url = await joinUrl(s.inviteCode);
  const qrPng = await QRCode.toBuffer(url, { type: 'png', margin: 1, width: 640, errorCorrectionLevel: 'M', color: { dark: '#1E4D2B', light: '#FFFFFF' } });

  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const green = rgb(0.118, 0.302, 0.169);
  const turmeric = rgb(0.91, 0.627, 0.125);
  const center = (t: string, y: number, size: number, f = font, color = rgb(0.13, 0.12, 0.11)) =>
    page.drawText(t, { x: (595 - f.widthOfTextAtSize(t, size)) / 2, y, size, font: f, color });

  page.drawRectangle({ x: 0, y: 700, width: 595, height: 142, color: green });
  center(BRAND.appName, 770, 44, bold, rgb(1, 1, 1));
  center(BRAND.tagline, 735, 16, font, turmeric);
  center('Home-cooked food from your neighbours', 640, 26, bold);
  center(`in ${s.name}`, 608, 20, font, green);
  const img = await pdf.embedPng(qrPng);
  page.drawImage(img, { x: 147, y: 250, width: 300, height: 300 });
  center('Scan to join — or list your own kitchen', 215, 18, bold);
  center(url, 190, 11);
  center(`Invite code: ${s.inviteCode}`, 165, 14, bold, green);
  center('You pay the kitchen directly by UPI or at pickup. A small platform fee supports the app.', 90, 10);
  center(`${BRAND.appName} · ${BRAND.supportEmail}`, 70, 10);
  const bytes = await pdf.save();
  return new NextResponse(new Uint8Array(bytes), {
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="padosiplate-poster-${s.inviteCode}.pdf"`, 'Cache-Control': 'private, no-store' },
  });
});
