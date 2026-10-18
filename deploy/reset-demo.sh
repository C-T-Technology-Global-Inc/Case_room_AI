#!/bin/sh
# Reload the synthetic demo data: ERASES the demo database and uploaded files,
# then loads the demo patients again. Run once after the first start, and
# nightly from cron (docs/DEPLOY_DEMO.md).
set -eu
cd "$(dirname "$0")"

docker compose --profile reset run --rm seed
# Uploaded originals belong to documents that no longer exist.
docker compose exec -T web sh -c 'rm -rf /data/storage/cases'
echo "Demo data reloaded at $(date -u '+%Y-%m-%d %H:%M UTC')"
