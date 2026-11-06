import { and, eq, gt } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { getPlatformSettings } from '@/lib/db/platform';
import { notificationPrefs, notifications, pushSubscriptions, users } from '@/lib/db/schema';
import { sendEmail } from '@/lib/email';
import { siteOriginSafe } from '@/lib/site-url';
import { istHour } from '@/lib/time';
import { messageAdapter, sendPush, vapidConfigured } from '@/lib/notify/adapters';
import { EVENTS, TEMPLATE_VERSION, type Ctx, type EventKey } from '@/lib/notify/events';
import { log } from '@/lib/log';

export { EVENTS, EVENT_KEYS, TEMPLATE_VERSION, type EventKey } from '@/lib/notify/events';

export type Prefs = { pushEnabled: boolean; whatsappEnabled: boolean; smsEnabled: boolean; marketingEnabled: boolean };
export const DEFAULT_PREFS: Prefs = { pushEnabled: true, whatsappEnabled: false, smsEnabled: false, marketingEnabled: false };

export async function getPrefs(userId: number): Promise<Prefs> {
  const db = await getDb();
  const [p] = await db.select().from(notificationPrefs).where(eq(notificationPrefs.userId, userId));
  return p ? { pushEnabled: p.pushEnabled, whatsappEnabled: p.whatsappEnabled, smsEnabled: p.smsEnabled, marketingEnabled: p.marketingEnabled } : { ...DEFAULT_PREFS };
}

export async function setPrefs(userId: number, patch: Partial<Prefs>): Promise<Prefs> {
  const db = await getDb();
  const next = { ...(await getPrefs(userId)), ...patch };
  await db.insert(notificationPrefs).values({ userId, ...next }).onConflictDoUpdate({ target: notificationPrefs.userId, set: { ...next, updatedAt: new Date() } });
  return next;
}

/** Quiet hours (IST), wrapping midnight when start > end (e.g. 22 → 7). */
export function inQuietHours(now: Date, start: number, end: number): boolean {
  const h = istHour(now);
  if (start === end) return false;
  return start < end ? h >= start && h < end : h >= start || h < end;
}

export type EmitResult = { sent: boolean; skipped?: 'debounced' | 'no_user'; inApp: boolean; email: boolean; push: number; whatsapp: boolean; sms: boolean };

/**
 * The one way the app tells a person something about an event.
 *   in-app   always
 *   email    always for transactional events (never opt-out-able; marketing is a separate, opt-in path)
 *   push     if the user allows it, has a subscription, VAPID is configured, and (it is urgent or not quiet hours)
 *   WhatsApp / SMS   opt-in per user, same quiet-hours rule; mock adapters until a provider is configured
 * Chat messages are debounced: one alert per order per person per `chatNotifyDebounceMinutes`.
 */
export async function emit(event: EventKey, userId: number, ctx: Ctx = {}, now: Date = new Date()): Promise<EmitResult> {
  const def = EVENTS[event];
  const out: EmitResult = { sent: false, inApp: false, email: false, push: 0, whatsapp: false, sms: false };
  const db = await getDb();
  const [user] = await db.select({ id: users.id, email: users.email, phone: users.phone }).from(users).where(eq(users.id, userId));
  if (!user) return { ...out, skipped: 'no_user' };
  const settings = await getPlatformSettings();
  const msg = def.build(ctx);

  if ('debounceMinutes' in def) {
    const since = new Date(now.getTime() - settings.chatNotifyDebounceMinutes * 60_000);
    const [recent] = await db.select({ id: notifications.id }).from(notifications).where(and(eq(notifications.userId, userId), eq(notifications.eventKey, event), eq(notifications.href, msg.href), gt(notifications.createdAt, since))).limit(1);
    if (recent) return { ...out, skipped: 'debounced' };
  }

  await db.insert(notifications).values({ userId, title: msg.title, body: msg.body, href: msg.href, eventKey: event, createdAt: now });
  out.inApp = true;
  out.sent = true;

  if (def.email && user.email) {
    await sendEmail({ userId, to: user.email, kind: 'notification', subject: msg.title.replace(/[\u{1F300}-\u{1FAFF}☀-➿]/gu, '').trim(), text: `${msg.body}\n\n${await siteOriginSafe()}${msg.href}` });
    out.email = true;
  }

  const prefs = await getPrefs(userId);
  const quiet = !def.urgent && inQuietHours(now, settings.quietHoursStart, settings.quietHoursEnd);
  if (quiet) return out;

  if (settings.pushEnabled && prefs.pushEnabled && vapidConfigured()) {
    const subs = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
    for (const s of subs) {
      const r = await sendPush({ endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth }, { title: msg.title, body: msg.body, href: msg.href, tag: event });
      if (r.ok) out.push++;
      else if (r.gone) await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, s.id)); // expired subscription: clean up
    }
  }
  if (user.phone) {
    const text = `${msg.title}. ${msg.body}`.slice(0, 300);
    if (prefs.whatsappEnabled) {
      await messageAdapter('whatsapp').send({ userId, toPhone: user.phone, body: text, eventKey: event });
      out.whatsapp = true;
    }
    if (prefs.smsEnabled) {
      await messageAdapter('sms').send({ userId, toPhone: user.phone, body: text, eventKey: event });
      out.sms = true;
    }
  }
  log.info('notify.emit', { event, v: TEMPLATE_VERSION, push: out.push, email: out.email });
  return out;
}

/** Emit to every admin (dispute alerts etc.). */
export async function emitToAdmins(event: EventKey, ctx: Ctx = {}, now: Date = new Date()): Promise<void> {
  const db = await getDb();
  const admins = await db.select({ id: users.id }).from(users).where(eq(users.role, 'admin'));
  for (const a of admins) await emit(event, a.id, { ...ctx, role: 'admin' }, now);
}
