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
