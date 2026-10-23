import crypto from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { emailTokens } from '@/lib/db/schema';

export type TokenKind = 'verify' | 'reset';
export const TOKEN_TTL_MS: Record<TokenKind, number> = {
  verify: 24 * 60 * 60 * 1000,
  reset: 30 * 60 * 1000,
};

const sha = (t: string) => crypto.createHash('sha256').update(t).digest('hex');

/** Issues a fresh single-use token (invalidating earlier unused ones of the same kind). Returns the raw token. */
export async function issueToken(userId: number, kind: TokenKind, now = new Date()): Promise<string> {
  const db = await getDb();
  await db.update(emailTokens).set({ usedAt: now }).where(and(eq(emailTokens.userId, userId), eq(emailTokens.kind, kind), isNull(emailTokens.usedAt)));
  const raw = crypto.randomBytes(32).toString('base64url');
  await db.insert(emailTokens).values({ userId, kind, tokenHash: sha(raw), expiresAt: new Date(now.getTime() + TOKEN_TTL_MS[kind]) });
  return raw;
}

/** Atomically consumes a token: returns the user id exactly once, or null if unknown/expired/used. */
export async function consumeToken(raw: string, kind: TokenKind, now = new Date()): Promise<number | null> {
  if (!raw || raw.length > 100) return null;
  const db = await getDb();
  const [row] = await db
    .update(emailTokens)
    .set({ usedAt: now })
    .where(and(eq(emailTokens.tokenHash, sha(raw)), eq(emailTokens.kind, kind), isNull(emailTokens.usedAt), gt(emailTokens.expiresAt, now)))
    .returning({ userId: emailTokens.userId });
  return row?.userId ?? null;
}
