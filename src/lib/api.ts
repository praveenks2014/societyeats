import { NextRequest, NextResponse } from 'next/server';
import { log, newRequestId } from '@/lib/log';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    /** Machine-readable reason the client can act on (e.g. 'mfa_required', 'reauth_required'). */
    public code?: string,
  ) {
    super(message);
  }
}

type Handler<Ctx> = (req: NextRequest, ctx: Ctx) => Promise<NextResponse | Response>;

/** Wraps a route handler with uniform JSON error handling. */
/** Next 15+ passes route params as a Promise; handlers keep receiving plain `{ params }`. */
type RouteCtx<Ctx> = Ctx extends { params: infer P } ? Omit<Ctx, 'params'> & { params: Promise<P> | P } : Ctx;

export function api<Ctx = unknown>(fn: Handler<Ctx>): Handler<RouteCtx<Ctx>> {
  return async (req, rawCtx) => {
    try {
      const ctx = (rawCtx && typeof rawCtx === 'object' && 'params' in rawCtx ? { ...rawCtx, params: await (rawCtx as { params: unknown }).params } : rawCtx) as Ctx;
      return await fn(req, ctx);
    } catch (err) {
      if (err instanceof ApiError) {
        return NextResponse.json({ error: err.message, ...(err.code ? { code: err.code } : {}) }, { status: err.status });
      }
      const ref = req.headers?.get?.('x-request-id') ?? newRequestId();
      log.error('api.unhandled', { path: req.nextUrl?.pathname, method: req.method, ref, err });
      return NextResponse.json({ error: `Something went wrong (reference ${ref})`, ref }, { status: 500, headers: { 'x-request-id': ref } });
    }
  };
}

export function ok(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

export async function readJson<T>(req: NextRequest): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new ApiError(400, 'Invalid JSON body');
  }
}

export function otp4(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}
