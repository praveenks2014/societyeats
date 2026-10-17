import bcrypt from 'bcryptjs';

export const MIN_PASSWORD_LENGTH = 8;

/** A short list of the most-used passwords; rejected even when long enough. */
const COMMON = new Set([
  '12345678', '123456789', '1234567890', 'password', 'password1', 'password123', 'passw0rd', 'qwertyui', 'qwerty123',
  'qwertyuiop', 'iloveyou', 'admin123', 'administrator', 'welcome1', 'welcome123', 'letmein1', 'letmein123', 'abc12345',
  'abcd1234', '11111111', '00000000', '88888888', '987654321', '12341234', '1q2w3e4r', '1qaz2wsx', 'monkey123',
  'dragon123', 'football1', 'cricket123', 'india123', 'india@123', 'hyderabad', 'hyderabad1', 'hyderabad123', 'sachin10',
  'krishna123', 'ganesh123', 'ramesh123', 'sunshine1', 'princess1', 'master123', 'shadow123', 'superman1', 'baseball1',
  'trustno1', 'changeme', 'changeme1', 'padosiplate', 'padosi123', 'padosiplate1', 'demo1234', 'test1234', 'test@123',
  'pass@123', 'pass1234', 'user1234', 'login123', 'secret123', 'google123', 'whatsapp1', 'mobile123', 'phone1234',
]);

export function validatePassword(pw: string, context: { phone?: string; email?: string } = {}): string | null {
  if (typeof pw !== 'string' || pw.length < MIN_PASSWORD_LENGTH) return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  if (pw.length > 128) return 'Password is too long';
  const lower = pw.toLowerCase();
  if (COMMON.has(lower)) return 'That password is too common — choose something harder to guess';
  if (/^(.)\1+$/.test(pw)) return 'Password cannot be a single repeated character';
  if (context.phone && lower.includes(context.phone)) return 'Password should not contain your phone number';
  const local = context.email?.split('@')[0]?.toLowerCase();
  if (local && local.length >= 4 && lower === local) return 'Password should not be your email name';
  return null;
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
