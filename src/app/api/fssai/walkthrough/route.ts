import { api, ok } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { LANGS, getWalkthrough } from '@/lib/fssai/content';

export const dynamic = 'force-dynamic';

export const GET = api(async (req) => {
  await requireSession();
  const lang = req.nextUrl.searchParams.get('lang') ?? 'en';
  const code = LANGS.some((l) => l.code === lang) ? lang : 'en';
  return ok({ lang: code, languages: LANGS, steps: await getWalkthrough(code) });
});
