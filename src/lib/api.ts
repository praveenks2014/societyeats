import { NextRequest, NextResponse } from 'next/server';
import { log } from '@/lib/log';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

type Handler<Ctx> = (req: NextRequest, ctx: Ctx) => Promise<NextResponse | Response>;

/** Wraps a route handler with uniform JSON error handling. */
export function api<Ctx = unknown>(fn: Handler<Ctx>): Handler<Ctx> {
  return async (req, ctx) => {
    try {
      return await fn(req, ctx);
    } catch (err) {
      if (err instanceof ApiError) {
        return NextResponse.json({ error: err.message }, { status: err.status });
      }
      log.error('api.unhandled', { path: req.nextUrl?.pathname, method: req.method, err });
      return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
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
