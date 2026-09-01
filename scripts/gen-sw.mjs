/**
 * npm run prebuild (runs automatically before `npm run build`, via npm's
 * pre-script convention)
 *
 * Stamps public/sw.template.js into public/sw.js with a cache name baked
 * from package.json's version plus a fresh build id, so every deploy busts
 * every previous service-worker cache even when the version field in
 * package.json hasn't changed. public/sw.js is a generated build artifact
 * (gitignored) — public/sw.template.js is the source of truth.
 */
import fs from 'node:fs';
import path from 'node:path';

const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));

// Prefer a CI/host-provided commit or deployment id when one is set (Replit
// deployments, GitHub Actions, Vercel, ...); otherwise a fresh timestamp —
// either way every build gets a cache name distinct from the last one.
const buildId =
  process.env.SOURCE_VERSION ||
  process.env.REPL_DEPLOYMENT_ID ||
  process.env.GITHUB_SHA?.slice(0, 7) ||
  process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ||
  Date.now().toString(36);

const cacheVersion = `gharse-v${pkg.version}-${buildId}`;

const templatePath = path.join(process.cwd(), 'public', 'sw.template.js');
const outPath = path.join(process.cwd(), 'public', 'sw.js');
const template = fs.readFileSync(templatePath, 'utf8');
const output = template.replaceAll('__SW_CACHE_VERSION__', cacheVersion);
fs.writeFileSync(outPath, output);

console.log(`[gen-sw] public/sw.js generated — cache version "${cacheVersion}"`);
