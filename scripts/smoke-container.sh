#!/usr/bin/env bash
# Smoke test of a running Clinical Case Room server with the synthetic demo data.
#
# Usage: DATABASE_URL=postgresql://... scripts/smoke-container.sh http://localhost:3000
#
# Checks health, readiness, sign-in, database-backed pages, a PDF upload that is
# text-extracted, stored as an original file, processed in the background and
# downloaded byte for byte. Needs curl and psql; DATABASE_URL must point to the
# server's database (set SMOKE_SKIP_DATABASE_CHECKS=1 only for a quick local run).
set -euo pipefail

BASE="${1:-http://localhost:3000}"
HERE="$(cd "$(dirname "$0")" && pwd)"
PDF="$HERE/fixtures/synthetic-report.pdf"
JAR="$(mktemp)"
DOWNLOAD="$(mktemp)"
trap 'rm -f "$JAR" "$DOWNLOAD"' EXIT
# Every request has a deadline: a hung server fails the smoke test fast instead of hanging the CI job.
curl() { command curl --connect-timeout 5 --max-time "${SMOKE_REQUEST_TIMEOUT:-60}" "$@"; }
fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }
sha256() { if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }

database_checks=1
if [ "${SMOKE_SKIP_DATABASE_CHECKS:-}" = "1" ]; then
  database_checks=0
elif ! command -v psql >/dev/null || [ -z "${DATABASE_URL:-}" ]; then
  fail "psql and DATABASE_URL are required (or set SMOKE_SKIP_DATABASE_CHECKS=1)"
fi
sql() { psql "$DATABASE_URL" -Atc "$1"; }

for _ in $(seq 1 60); do
  curl -fsS "$BASE/api/health" >/dev/null 2>&1 && break
  sleep 1
done
# Responses are captured first: with pipefail, `curl | grep -q` can fail on SIGPIPE.
health="$(curl -fsS "$BASE/api/health")" && grep -q '"ok"' <<<"$health" || fail "liveness"
pass "liveness /api/health"
ready="$(curl -fsS "$BASE/api/ready")" && grep -q '"ready"' <<<"$ready" || fail "readiness"
pass "readiness /api/ready"

csrf="$(curl -fsS -c "$JAR" -b "$JAR" "$BASE/api/auth/csrf" | sed -E 's/.*"csrfToken":"([^"]+)".*/\1/')"
[ -n "$csrf" ] || fail "csrf token"
status="$(curl -sS -o /dev/null -w '%{http_code}' -c "$JAR" -b "$JAR" -X POST "$BASE/api/auth/callback/credentials" \
  --data-urlencode "csrfToken=$csrf" --data-urlencode "email=nguyen@riverside.demo" \
  --data-urlencode "password=demo1234" --data-urlencode "callbackUrl=$BASE/dashboard")"
[ "$status" = "302" ] && grep -q "session-token" "$JAR" || fail "sign-in (HTTP $status)"
pass "sign-in with a demo account"

dashboard="$(curl -fsS -b "$JAR" "$BASE/dashboard")"
grep -q "Riverside Cancer Center" <<<"$dashboard" || fail "dashboard"
pass "dashboard renders from the database"

cases="$(curl -fsS -b "$JAR" "$BASE/cases")"
case_id="$(grep -oE '/cases/c[a-z0-9]{20,}' <<<"$cases" | head -1 | cut -d/ -f3)"
[ -n "$case_id" ] || fail "case list"
pass "case list ($case_id)"

response="$(curl -sS -b "$JAR" -X POST "$BASE/api/cases/$case_id/documents" \
  -F "title=Container smoke PDF" -F "type=PATHOLOGY_REPORT" -F "documentDate=2026-10-01" \
  -F "file=@$PDF;type=application/pdf")"
document_id="$(sed -nE 's/.*"id":"([^"]+)".*/\1/p' <<<"$response")"
[ -n "$document_id" ] || fail "PDF upload: $response"
grep -q '"characters":[1-9]' <<<"$response" || fail "PDF text extraction: $response"
pass "PDF upload and text extraction"

if [ "$database_checks" = "1" ]; then
  [ -n "$(sql "select \"fileKey\" from \"ClinicalDocument\" where id = '$document_id' and \"fileKey\" is not null")" ] ||
    fail "the original file was not stored (no fileKey)"
  pass "original file stored"
  state=""
  for _ in $(seq 1 60); do
    state="$(sql "select \"processingStatus\" from \"ClinicalDocument\" where id = '$document_id'")"
    if [ "$state" = "COMPLETED" ] || [ "$state" = "FAILED" ]; then break; fi
    sleep 1
  done
  [ "$state" = "COMPLETED" ] || fail "background processing ended as '$state'"
  pass "background AI processing completed"
fi

status="$(curl -sS -o "$DOWNLOAD" -w '%{http_code}' -b "$JAR" "$BASE/api/cases/$case_id/documents/$document_id/file")"
[ "$status" = "200" ] || fail "download of the original (HTTP $status)"
[ "$(sha256 "$DOWNLOAD")" = "$(sha256 "$PDF")" ] || fail "downloaded original differs from the upload"
pass "original downloaded intact (SHA-256 matches)"
echo "All container smoke checks passed."
