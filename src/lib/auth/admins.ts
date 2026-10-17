import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { hashPassword } from './passwords';
import { referralCodeFor } from '@/lib/referrals';

/**
 * Admin access is ENV-DRIVEN: a user is an admin if and only if their
 * VERIFIED email is in ADMIN_EMAILS. The stored `users.role` is never trusted
 * on its own — removing an email from the list demotes immediately.
 */
export function adminEmails(): string[] {
  const list = (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  // Dev-only convenience: the seeded demo admin. Never present in production
  // unless demo seeding was explicitly allowed.
  if (process.env.NODE_ENV !== 'production' || process.env.ALLOW_DEMO_SEED === 'true') {
    list.push(DEMO_ADMIN_EMAIL);
  }
  return list;
}

export const DEMO_ADMIN_EMAIL = 'admin@demo.padosiplate.example';

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return adminEmails().includes(email.trim().toLowerCase());
}

type RoleUser = { role: 'buyer' | 'seller' | 'restaurant' | 'admin'; email: string | null; emailVerifiedAt: Date | null };

/** The role this user actually holds right now. */
export function effectiveRole(u: RoleUser): RoleUser['role'] {
  if (isAdminEmail(u.email) && u.emailVerifiedAt) return 'admin';
  if (u.role === 'admin') return 'buyer'; // stale DB admin without an allowlisted+verified email
  return u.role;
}

/** Persist admin promotion once an allowlisted email is verified. Returns true if promoted. */
export async function promoteIfAllowlisted(db: Db, userId: number): Promise<boolean> {
  const [u] = await db.select().from(users).where(eq(users.id, userId));
  if (!u || !isAdminEmail(u.email) || !u.emailVerifiedAt || u.role === 'admin') return false;
  await db.update(users).set({ role: 'admin' }).where(eq(users.id, userId));
  return true;
}

function randomPassword(): string {
  // 16 chars from an unambiguous alphabet.
  const alphabet = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(16);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

/**
 * Creates any ADMIN_EMAILS account that does not exist yet (verified email,
 * must_change_password=true). Returns the one-time passwords to print once.
 * Existing accounts are only promoted, never reset.
 */
export async function ensureAdminAccounts(db: Db): Promise<{ email: string; password: string }[]> {
  const created: { email: string; password: string }[] = [];
  const emails = (process.env.ADMIN_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  for (const email of emails) {
    const [existing] = await db.select().from(users).where(eq(users.email, email));
    if (existing) {
      if (!existing.emailVerifiedAt) continue; // promoted automatically on verification
      if (existing.role !== 'admin') await db.update(users).set({ role: 'admin' }).where(eq(users.id, existing.id));
      continue;
    }
    const password = process.env.ADMIN_BOOTSTRAP_PASSWORD || randomPassword();
    // Placeholder phone: admins are not residents. 'a' + 9 digits keeps it unique and non-dialable.
    const phone = `a${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
    const [row] = await db
      .insert(users)
      .values({
        phone,
        email,
        emailVerifiedAt: new Date(),
        name: email.split('@')[0],
        passwordHash: await hashPassword(password),
        role: 'admin',
        mustChangePassword: true,
      })
      .returning();
    await db.update(users).set({ referralCode: referralCodeFor(row.id) }).where(eq(users.id, row.id));
    created.push({ email, password });
  }
  return created;
}
