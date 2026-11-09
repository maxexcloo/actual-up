# Configuration

Deployment settings come from the version 1 YAML file. Start from
[config.example.yaml](../config.example.yaml); optional settings and their
defaults are defined in [src/config.ts](../src/config.ts). Actual credentials,
Up API keys and account mappings are managed in the browser under **Accounts & Sync**. Never commit credentials to either repository.

## Authentication

The app login comes from `ACTUAL_UP_USERNAME` and `ACTUAL_UP_PASSWORD`.
Sessions reset on restart; signing out invalidates the session. Failed sign-ins
are rate-limited.

Use a private HTTPS route in production. Set `server.publicUrl` to the external
HTTPS URL, or supply `ACTUAL_UP_PUBLIC_URL` to override it through the environment.
The effective URL sets the expected origin and turns on Secure cookies. Without
it, actions must match the request's own origin. All POSTs, including sign-in,
require a matching Origin. The app shell and its built assets are public;
state and operations require a session. `/livez`, `/readyz` and `/metrics` remain available
for cluster probes and monitoring.

Serve the app behind exactly one reverse proxy, such as Kubelab's Traefik. The
app trusts that proxy's `X-Forwarded-For` hop to key sign-in rate limits by client
address; without a proxy, clients could choose their own address.

## Browser Setup

1. Open **Settings** and enter the Actual server URL, budget sync ID and session
   token or password. An encrypted budget also needs its encryption password.
   Use a session token for an OIDC-backed Actual deployment.
2. Add each Up API key under a short name, then **Test & Save**. Saving checks
   only what changed: a changed Actual connection is opened, and new keys are
   pinged. Leaving a credential or key blank keeps the saved value; existing
   keys are never sent back to the browser.
3. Under **Accounts**, choose an Actual account for each Up account you want to
   sync, then **Save Accounts**. A shared 2Up account appears once; tick both
   partners' keys for fallback access.

Settings saves wait for any running sync, because they reopen Actual. Account
saves are checked against the last account discovery and apply straight away.
Overlapping settings and account saves are rejected; wait for the current save
to finish before retrying. Each form rejects a save made from an outdated copy;
reload and retry.

A replacement Up key must still access its connected accounts. Disconnect
accounts before removing a key they use, switching Actual budgets or servers, or
choosing another Actual account for them. Clearing an account's Actual account
stops syncing it and keeps its existing Actual transactions.

Connecting a new account starts a full backfill when automation is enabled.
Renaming or changing keys does not start another backfill. Settings saves reject
an Actual server version the app doesn't support. The app starts without an
upstream connection, so the browser is still available for first-time setup and
repairs.

**Sync Status** runs a sync or preview for all accounts or one, over the
recent window or from a chosen date. **Check Connections** pings every key and
validates the mappings without importing. **Logs** shows recent
log lines, which never include bank data and reset on restart.

## Encrypted Storage

`settingsFile` stores credentials, account IDs and mappings together as
authenticated ciphertext.

Supply `ACTUAL_UP_ENCRYPTION_KEY` as a randomly generated secret of at least
32 characters. It is separate from the app password and never written to the
settings file. The encrypted file
is authoritative for browser-managed settings on startup, including CLI commands.
Schedules, note options and category mappings stay in deployment configuration.

Persist and back up the configured settings file (`/data/settings.json` in
production) and retain its matching encryption key.
Don't just rotate that key, because existing settings will become unreadable.
Corrupt, tampered or incorrectly keyed settings stop startup instead of silently
resetting.
Stop the service before restoring a backup or resetting setup by removing the file.
A reset returns to the YAML defaults and requires re-entering saved credentials.
Actual's budget cache is separate and is not encrypted by this settings mechanism.

## Deployment Defaults

`actual.serverUrl` prefills the Actual setup form; prefer a server URL reachable
from the service. Leave `up.connections` empty for browser setup, as in the example.

Aliases are non-sensitive labels used in logs. Each Up and Actual account may
appear in only one mapping. Shared connections follow the displayed fallback order.

`categoryMappings` maps Up category IDs to Actual category IDs. Actual rules run
first; a mapping applies only if a transaction remains uncategorised. The `notes`
flags control create-only enrichment. Existing notes are never overwritten.

## Schedule

Mapped accounts are backfilled on startup. `schedule.cron` controls recent
syncs, `schedule.backfillCron` controls full-history backfills and
`schedule.timezone` sets their timezone. `schedule.lookbackDays` sets the recent
window. No work is scheduled until at least one account is mapped. Stable import
IDs prevent duplicates.

Set `schedule.enabled: false` to disable automatic writes while retaining manual
preview and sync. Restart after changing deployment configuration.

Polling doesn't need a public endpoint, so keep the UI private. Queued jobs live
in memory and aren't durable; periodic reconciliation picks up missed work.

Keep `actual.cacheDirectory` on local pod storage, not NFS. Actual rebuilds this
cache from the server, while the encrypted app settings stay on persistent
storage.

## Kubelab & 1Password

Kubelab provisions the app login and settings encryption key in the `Actual Up`
item in `Kubelab SYD`. It preserves existing non-empty fields.

Actual and Up credentials are entered in the app; the app does not receive a
1Password API credential or vault access.
