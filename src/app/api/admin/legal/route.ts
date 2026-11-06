import { api, ok } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { listLegalDocuments, seedLegalDocuments } from '@/lib/legal/docs';
import { listDisclaimers, seedDisclaimers } from '@/lib/disclaimers';

export const dynamic = 'force-dynamic';

export const GET = api(async () => {
  await requireSession(['admin']);
  await seedLegalDocuments();
  await seedDisclaimers();
  const documents = (await listLegalDocuments()).map(({ body, ...d }) => ({ ...d, bodyLength: body.length }));
  return ok({ documents, disclaimers: await listDisclaimers() });
});
