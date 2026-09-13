#!/usr/bin/env sh
# One heartbeat to the JUDECH Supabase project, from any machine or cron.
# Usage:  sh keepalive/ping.sh            (or make it executable and run it)
# Cron:   0 9 */3 * *  /path/to/keepalive/ping.sh
SUPABASE_URL="https://eghmgcwasumsvsanimmp.supabase.co"
SUPABASE_ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVnaG1nY3dhc3Vtc3ZzYW5pbW1wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkwMjc2NjgsImV4cCI6MjEwNDYwMzY2OH0.PVnDAli4i3n8mIE2ETYnEk9xGDKyIB2MDOSB_ARjNcI"
curl -sS --fail -X POST "$SUPABASE_URL/rest/v1/rpc/heartbeat" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"p_source":"cron"}'
echo
