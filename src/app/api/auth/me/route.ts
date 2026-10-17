import { api, ok } from '@/lib/api';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export const GET = api(async () => {
  const s = await getSession();
  return ok({ session: s ? { uid: s.uid, role: s.role, name: s.name, emailVerified: s.emailVerified, mustChangePassword: s.mustChangePassword, approvalStatus: s.approvalStatus, societyId: s.societyId } : null });
});
