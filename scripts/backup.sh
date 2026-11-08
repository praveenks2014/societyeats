#!/usr/bin/env bash
# npm run db:backup — timestamped pg_dump of DATABASE_URL into ./backups (keeps the newest 14).
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL is required}"
mkdir -p backups
slug="$(node -p "require('./src/config/brand.json').slug")"
out="backups/${slug}-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
pg_dump --no-owner --no-privileges "$DATABASE_URL" | gzip > "$out"
ls -1t backups/*.sql.gz | tail -n +15 | xargs -r rm --
echo "backup written: $out"
