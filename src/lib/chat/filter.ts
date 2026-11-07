/**
 * Soft filter for chat (Pilot v2 step 8). It never silently drops or rewrites a message: it returns what it
 * found so the sender can be warned BEFORE sending and then choose. The same findings are stored on the message
 * so a payment request before the door shows the recipient the pay-at-door reminder.
 */
export type ChatWarningKind = 'phone' | 'link' | 'payment' | 'abuse';
export type ChatWarning = { kind: ChatWarningKind; message: string };

const UPI_ID = /\b[a-z0-9._-]{2,64}@[a-z]{2,20}\b/i;
const PHONE = /(?:\+?\d[\s-]?){9,}/;
const LINK = /https?:\/\/|www\.|\b[a-z0-9-]+\.(?:com|in|me|io|co|net|org|link)\b/i;
const PAYMENT_PHRASES = /\b(send|transfer|pay|paying)\b[^.!?\n]{0,25}(?:₹|rs\.?|inr|rupees?|\d{2,})|\bpay\s+(?:to|me|now|first|in advance|advance)\b|\badvance\b|\bgpay\b|\bphonepe\b|\bpaytm\b|\bupi\s*(?:id|number|link)\b|\bqr\s*code\b/i;

export function parseWords(csv: string): string[] {
  return csv.split(',').map((w) => w.trim().toLowerCase()).filter(Boolean);
}

function normalise(text: string): string {
  return text.toLowerCase().replace(/[@4]/g, 'a').replace(/[1!]/g, 'i').replace(/0/g, 'o').replace(/\$/g, 's').replace(/[^a-z\s]/g, ' ');
}

export function hasAbuse(text: string, wordsCsv: string): boolean {
  const words = parseWords(wordsCsv);
  if (!words.length) return false;
  const re = new RegExp(`\\b(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'i');
  return re.test(normalise(text)) || re.test(text);
}

export function isPaymentRequest(text: string): boolean {
  return PAYMENT_PHRASES.test(text) || UPI_ID.test(text);
}

export function checkOutgoing(text: string, opts: { badWordsCsv: string }): ChatWarning[] {
  const out: ChatWarning[] = [];
  if (PHONE.test(text)) out.push({ kind: 'phone', message: 'This looks like a phone number. Share it only if you both want to, using the “Share my number” switch.' });
  if (LINK.test(text)) out.push({ kind: 'link', message: 'Links can be unsafe. Avoid opening or sending links.' });
  if (isPaymentRequest(text)) out.push({ kind: 'payment', message: 'This looks like a payment request. You pay the kitchen at your door, after the food arrives, never in advance or via a link or UPI ID in chat.' });
  if (hasAbuse(text, opts.badWordsCsv)) out.push({ kind: 'abuse', message: 'This message contains abusive words. Abusive users are removed.' });
  return out;
}
