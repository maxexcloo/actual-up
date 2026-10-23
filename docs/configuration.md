# Configuration

Deployment settings come from the version 1 YAML file. Start from
[config.example.yaml](../config.example.yaml); optional settings use the defaults
below. Actual credentials, Up API keys and account mappings are managed in the
browser under **Accounts & Sync**. Never commit credentials to either repository.

## Authentication

The app login comes from `ACTUAL_UP_USERNAME` and `ACTUAL_UP_PASSWORD`. Kubelab generates a strong production password. The app
uses a normal sign-in page and opaque server-side sessions, with HttpOnly,
SameSite=Strict cookies and an eight-hour lifetime. Sessions reset on restart;
signing out invalidates the session. Failed sign-ins are rate-limited.

Use a private HTTPS route in production. Set `server.publicUrl` to the external
HTTPS URL, or supply `ACTUAL_UP_PUBLIC_URL` to override it through the environment.
The override goes through the same HTTP/HTTPS URL validation and rejects empty
or invalid values. The effective URL sets the expected origin and turns on Secure
cookies. Without it, actions must match the request's own origin. All POSTs, including sign-in,
require a matching Origin. The app shell and its built assets are public;
state and operations require a session. `/livez`, `/readyz` and `/metrics` remain available
for cluster probes and monitoring.

Serve the app behind exactly one reverse proxy, such as Kubelab's Traefik. The
app trusts that proxy's `X-Forwarded-For` hop to key sign-in rate limits by client
address; without a proxy, clients could choose their own address.

## Browser Setup

1. Enter the Actual server URL, budget sync ID and session token or password.
   An encrypted budget also needs its encryption password. Use a session token
   for an OIDC-backed Actual deployment.
2. Add each Up API key under a short connection name. Keys are checked before
   saving. Replace or remove them here without editing YAML or restarting.
3. Refresh accounts and connect each Up account to its Actual destination.
   Shared accounts use one mapping; select both partners' keys for fallback access.

Use **Test Connection** on Actual or an Up connection to check its saved credentials.
Results appear inline without importing bank transactions.

Account changes save independently, so you can connect several accounts without
waiting for backfill. Only the affected account rows refresh, and drafts in other
rows stay where they are. Shared account rows update together. Actual operations and
backfills still run through one serial queue. The Actual API runs in a single
worker thread so its synchronous database work cannot block the web server.

Leaving credentials blank on the Actual edit form keeps the saved values.
Existing keys are never sent back to the browser. A replacement Up key must still access its
mapped accounts. Remove mappings before removing a key they use, switching
Actual budgets/servers or changing a mapping's destination. Disconnecting keeps
existing Actual transactions; review them before reconnecting elsewhere.

Connecting a new mapping starts a full backfill when automation is enabled.
Editing an existing mapping does not start another backfill. An unavailable
existing fallback key can be retained if another selected key works. Configuration
changes, connection checks and imports all run through one serial queue.

Actual's API and server must match in major and minor version, and connection
setup checks this before saving. The app starts without an upstream connection so
the browser is still available for first-time setup and repairs.

Each Up connection lists the accounts it can access, which are discovered
automatically after you save a key. **Sync** imports one account; a connection's **Sync All** imports its
mapped accounts; the page-level **Sync All** imports every mapping. A shared
account may appear beneath both connections but retains one mapping and one
import identity. Key settings, mapping edits and backfill controls stay visible.

## Encrypted Storage

`settingsFile` defaults to `/data/settings.json`. The app encrypts credentials,
account IDs and mappings together with AES-256-GCM, a fresh 96-bit nonce per save
and authenticated version context. Files are replaced atomically with mode 0600.
No application database is needed.

Supply `ACTUAL_UP_ENCRYPTION_KEY` as a randomly generated secret of at least 32 characters; kubelab generates 48. It is separate
from the app password and never written to the settings file. The encrypted file
is authoritative for browser-managed settings on startup, including CLI commands.
Schedules, note options and category mappings stay in deployment configuration.

Persist and back up `/data/settings.json` and retain its matching encryption key.
Don't just rotate that key, because existing settings will become unreadable.
Corrupt, tampered or incorrectly keyed settings stop startup instead of silently
resetting.
Stop the service before restoring a backup or resetting setup by removing the file.
A reset returns to the YAML defaults and requires re-entering saved credentials.
Actual's budget cache is separate and is not encrypted by this settings mechanism.

## Deployment Defaults

- `actual.cacheDirectory` defaults to `/tmp/actual-cache`.
- `actual.serverUrl` prefills the Actual setup form; prefer its internal cluster URL.
- `up.connections: []` starts with browser setup.

Aliases are non-sensitive labels used in logs. Each Up and Actual account may
appear in only one mapping. Shared connections follow the displayed fallback order.

`categoryMappings` maps Up category IDs to Actual category IDs. Actual rules run
first; a mapping applies only if a transaction remains uncategorised. The `notes`
flags control create-only enrichment. Existing notes are never overwritten.

## Schedule

`schedule.enabled` defaults to `true`. Mapped accounts are backfilled on startup,
with recent syncs every 15 minutes (`schedule.cron`) and full-history backfills
nightly at 03:00 (`schedule.backfillCron`). The timezone defaults to
`Australia/Sydney`; `lookbackDays` defaults to 30 for recent syncs. No work is
scheduled until at least one account is mapped. Stable import IDs prevent duplicates.
Set `schedule.enabled: false` to disable automatic writes while retaining manual
preview and sync. Restart after changing deployment configuration.

Polling doesn't need a public endpoint, so keep the UI private. Queued jobs live
in memory and aren't durable; periodic reconciliation picks up missed work.

Keep `actual.cacheDirectory` on local pod storage, not NFS. Actual rebuilds this
cache from the server, while the encrypted app settings stay on persistent
storage.

## Kubelab & 1Password

The `Actual Up` item in `Kubelab SYD` follows Kubelab's usual item
reconciliation and `ClusterSecretStore/onepassword` convention:

| Field            | Environment Variable       | Source                   |
| ---------------- | -------------------------- | ------------------------ |
| `encryption-key` | `ACTUAL_UP_ENCRYPTION_KEY` | Generated by kubelab     |
| `password`       | `ACTUAL_UP_PASSWORD`       | Generated by kubelab     |
| `username`       | `ACTUAL_UP_USERNAME`       | Default `max@excloo.com` |

Existing non-empty fields are preserved. Actual and Up credentials are entered
in the app; the app does not receive a 1Password API credential or vault access.
