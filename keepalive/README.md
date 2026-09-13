# Keeping the Supabase project awake

Supabase pauses a Free-plan project that sees no database activity for a week.
`.github/workflows/keepalive.yml` writes one heartbeat row **every day** through the
public REST API, from GitHub's servers — so it runs whether or not any PC or browser
of yours is on.

## One-time setup (about two minutes)

1. On GitHub: **Settings → Secrets and variables → Actions → New repository secret**, twice:

   | Name | Value |
   |---|---|
   | `SUPABASE_URL` | `https://<project-ref>.supabase.co` — the `SUPABASE_URL` from `js/config.js` |
   | `SUPABASE_ANON_KEY` | the anon / publishable key — the `SUPABASE_ANON_KEY` from `js/config.js` |

   That is the same public pair the website already ships to every visitor. Row Level
   Security guards the data; `heartbeat()` can only insert a timestamp. **Do not add the
   service-role key** — it is not needed and it bypasses every policy.

2. **Actions → Keep Supabase awake → Run workflow** once. A green run whose log ends in
   `Heartbeat recorded from github-actions` is the proof.

3. Open `admin.html`: the pulse in the header should read *Database active … via
   github-actions*.

From then on it runs daily at 02:17 UTC (10:17 in Manila). GitHub can delay a scheduled
run by some minutes under load; it never skips a day.

## By hand, from anywhere

```sh
SUPABASE_URL=https://xxxx.supabase.co SUPABASE_ANON_KEY=eyJ... sh keepalive/ping.sh
```

`ping.sh` reads the keys from the environment and never contains them.

## What counts as a failure

The job goes **red** if the secrets are missing, if Supabase answers anything but 2xx, or
if the reply does not confirm `source = github-actions`. A red run is the alarm — GitHub
emails the repository owner about failed scheduled workflows by default.

## Secondary layer

The heartbeat migration also schedules a daily `pg_cron` job inside the database where
that extension is enabled. It is a backup only; the rule Supabase applies is written
against outside activity, which is what the Action provides.
