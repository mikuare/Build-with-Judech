#!/usr/bin/env sh
# One heartbeat to the JUDECH Supabase project, from any machine or cron.
# The keys are read from the environment, never written here:
#   SUPABASE_URL=https://xxxx.supabase.co SUPABASE_ANON_KEY=eyJ... sh keepalive/ping.sh
# The GitHub Action in .github/workflows/keepalive.yml does the same daily.
set -eu
: "${SUPABASE_URL:?set SUPABASE_URL}"
: "${SUPABASE_ANON_KEY:?set SUPABASE_ANON_KEY}"
curl --silent --show-error --fail-with-body --max-time 30 \
  -X POST "${SUPABASE_URL%/}/rest/v1/rpc/heartbeat" \
  -H "apikey: ${SUPABASE_ANON_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_ANON_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"p_source\":\"${1:-cron}\"}"
echo
