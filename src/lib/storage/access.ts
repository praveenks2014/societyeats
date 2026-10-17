import type { Session } from '@/lib/auth';
import type { files } from '@/lib/db/schema';

type FileRow = typeof files.$inferSelect;

/**
 * Authorisation for private files: the uploader and admins always; other
 * participants (thread attachments, complaint evidence) are resolved by the
 * feature that owns the attachment via registered resolvers.
 */
type Resolver = (session: Session, file: FileRow) => Promise<boolean>;
const resolvers: Resolver[] = [];

export function registerFileAccessResolver(r: Resolver) {
  resolvers.push(r);
}

export async function canViewPrivateFile(session: Session, file: FileRow): Promise<boolean> {
  if (session.role === 'admin') return true;
  if (file.ownerId === session.uid) return true;
  for (const r of resolvers) if (await r(session, file)) return true;
  return false;
}
