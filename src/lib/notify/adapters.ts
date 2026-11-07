import * as webpush from 'web-push';
import { getDb } from '@/lib/db';
import { messageOutbox } from '@/lib/db/schema';
import { log } from '@/lib/log';

// ---------------------------------------------------------------- web push (VAPID)
export type PushSub = { endpoint: string; p256dh: string; auth: string };
export type PushPayload = { title: string; body: string; href: string; tag?: string };
export type PushResult = { ok: true } | { ok: false; gone: boolean };
type PushSender = (sub: PushSub, payload: PushPayload) => Promise<PushResult>;

export function vapidConfigured(): boolean {
  return !!process.env.VAPID_PUBLIC_KEY?.trim() && !!process.env.VAPID_PRIVATE_KEY?.trim();
}
export const vapidPublicKey = () => process.env.VAPID_PUBLIC_KEY ?? '';

let override: PushSender | null = null;
/** Test hook: capture pushes instead of calling a push service. */
export function setPushSenderForTests(s: PushSender | null) {
  override = s;
}

const liveSender: PushSender = async (sub, payload) => {
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || `mailto:${process.env.SUPPORT_EMAIL || 'support@padosiplate.in'}`, process.env.VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);
  try {
    await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(payload), { TTL: 60 * 60 });
    return { ok: true };
  } catch (e) {
    const code = (e as { statusCode?: number }).statusCode;
    if (code !== 404 && code !== 410) log.warn('push.failed', { code });
    return { ok: false, gone: code === 404 || code === 410 };
  }
};

export async function sendPush(sub: PushSub, payload: PushPayload): Promise<PushResult> {
  return (override ?? liveSender)(sub, payload);
}

// ---------------------------------------------------------------- SMS / WhatsApp
/**
 * Adapter interfaces for SMS and WhatsApp. Only the mock exists: the row in `message_outbox` IS the delivery.
 * Planned live providers (not built): SMS via MSG91 (needs DLT registration and approved templates), WhatsApp via the
 * Meta WhatsApp Cloud API (needs a Business account and approved message templates).
 */
export interface MessageAdapter {
  readonly channel: 'sms' | 'whatsapp';
  send(m: { userId: number; toPhone: string; body: string; eventKey: string }): Promise<void>;
}
class MockMessageAdapter implements MessageAdapter {
  constructor(readonly channel: 'sms' | 'whatsapp') {}
  async send(m: { userId: number; toPhone: string; body: string; eventKey: string }) {
    const db = await getDb();
    await db.insert(messageOutbox).values({ channel: this.channel, userId: m.userId, toPhone: m.toPhone, body: m.body, eventKey: m.eventKey, status: 'mock' });
  }
}
export function messageAdapter(channel: 'sms' | 'whatsapp'): MessageAdapter {
  // A live adapter is selected here once configured (MSG91_AUTH_KEY / WHATSAPP_CLOUD_TOKEN); until then every send is a recorded mock.
  return new MockMessageAdapter(channel);
}
