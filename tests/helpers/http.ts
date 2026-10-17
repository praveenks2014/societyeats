import { NextRequest } from 'next/server';

export function jsonReq(path: string, body?: unknown, init: { method?: string; headers?: Record<string, string> } = {}) {
  return new NextRequest(`http://localhost:3000${path}`, {
    method: init.method ?? 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.0.0.1', ...init.headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export async function call(handler: (req: NextRequest, ctx: never) => Promise<Response>, req: NextRequest, params: Record<string, string> = {}) {
  const res = await handler(req, { params } as never);
  let json: Record<string, unknown> = {};
  try {
    json = await res.json();
  } catch {
    /* no body */
  }
  return { status: res.status, json };
}

import crypto from 'node:crypto';
import { createSession } from '@/lib/auth';
import { resetRequestContext } from './next-headers';

/** Switches the mocked cookie jar to a fresh session for `userId`. */
export async function loginAs(userId: number) {
  resetRequestContext();
  await createSession(userId);
}

export function checkoutSignature(razorpayOrderId: string, paymentId: string, secret = process.env.RAZORPAY_KEY_SECRET!) {
  return crypto.createHmac('sha256', secret).update(`${razorpayOrderId}|${paymentId}`).digest('hex');
}

export function webhookReq(body: unknown, opts: { eventId?: string; secret?: string; badSig?: boolean } = {}) {
  const raw = JSON.stringify(body);
  const sig = opts.badSig ? 'deadbeef' : crypto.createHmac('sha256', opts.secret ?? process.env.RAZORPAY_WEBHOOK_SECRET!).update(raw).digest('hex');
  return new NextRequest('http://localhost:3000/api/webhooks/razorpay', {
    method: 'POST',
    headers: { 'x-razorpay-signature': sig, ...(opts.eventId ? { 'x-razorpay-event-id': opts.eventId } : {}) },
    body: raw,
  });
}
