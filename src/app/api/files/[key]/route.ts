import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { api, ApiError } from '@/lib/api';
import { getSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { files } from '@/lib/db/schema';
import { recordAudit } from '@/lib/audit';
import { canViewPrivateFile } from '@/lib/storage/access';
import { decryptBytes } from '@/lib/storage/files';
import { getStorage } from '@/lib/storage';

export const dynamic = 'force-dynamic';

/**
 * Serves every uploaded object. Public dish/kitchen images get long-lived
 * immutable caching (keys are random and never reused); private documents are
 * auth-checked and never cached. Admin views of identity documents are
 * audit-logged.
 */
export const GET = api<{ params: { key: string } }>(async (_req, { params }) => {
  const key = params.key;
  if (!/^[a-f0-9]{24}\.[a-z0-9]{2,4}$/.test(key)) throw new ApiError(404, 'Not found');
  const db = await getDb();
  const [meta] = await db.select().from(files).where(eq(files.key, key));
  if (!meta) throw new ApiError(404, 'Not found');

  if (meta.visibility === 'private') {
    const session = await getSession();
    if (!session) throw new ApiError(401, 'Please log in');
    if (!(await canViewPrivateFile(session, meta))) throw new ApiError(403, 'Not allowed');
    if (session.role === 'admin' && meta.ownerId !== session.uid && ['fssai_doc', 'id_proof'].includes(meta.purpose)) {
      await recordAudit({ actorId: session.uid, action: 'document.view', targetType: 'file', targetId: key, meta: { purpose: meta.purpose, ownerId: meta.ownerId } });
    }
  }

  const raw = await (await getStorage()).get(key);
  if (!raw) throw new ApiError(404, 'Not found');
  const body = meta.encrypted ? decryptBytes(raw) : raw;
  return new NextResponse(new Uint8Array(body), {
    headers: {
      'Content-Type': meta.contentType,
      'Content-Length': String(body.length),
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': 'inline',
      'Cache-Control':
        meta.visibility === 'public' ? 'public, max-age=31536000, immutable' : 'private, no-store',
    },
  });
});
