import QRCode from 'qrcode';

/** upi://pay deep link (opens the buyer's UPI app on mobile). Amount in rupees with two decimals. */
export function buildUpiUri(o: { vpa: string; payeeName: string; amountInPaise: number; orderId: number }): string {
  const q = new URLSearchParams({
    pa: o.vpa,
    pn: o.payeeName,
    am: (o.amountInPaise / 100).toFixed(2),
    cu: 'INR',
    tn: `PP-${o.orderId}`,
  });
  // URLSearchParams encodes spaces as '+', which UPI apps do not decode — use %20.
  return `upi://pay?${q.toString().replaceAll('+', '%20')}`;
}

export async function upiQrSvg(uri: string): Promise<string> {
  return QRCode.toString(uri, { type: 'svg', margin: 1, width: 220, errorCorrectionLevel: 'M' });
}
