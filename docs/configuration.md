# Configuration

The version 1 YAML file supplies deployment settings. **Connections**
manages Actual credentials, Up API keys and account mappings in the browser.
Never commit credentials to either repository.

## Authentication

`auth.usernameEnv` defaults to `ACTUAL_UP_USERNAME`; `auth.passwordEnv` defaults
to `ACTUAL_UP_PASSWORD`. Kubelab generates a strong production password. The app
uses a normal sign-in page and opaque server-side sessions, with HttpOnly,
SameSite=Strict cookies and an eight-hour lifetime. Sessions reset on restart;
signing out invalidates the session. Failed sign-ins are rate-limited.

Use a private HTTPS route in production. Set `server.publicUrl` to the external
HTTPS URL: it supplies the expected origin and enables Secure cookies. Without
it, actions must match the request's own origin. All POSTs, including sign-in,
require a matching Origin. The login page and CSS are public; app pages and
operations require a session. `/livez`, `/readyz` and `/metrics` remain available
for cluster probes and monitoring.

## Browser Setup

1. Enter the Actual server URL, budget sync ID and session token or password.
   An encrypted budget also needs its encryption password. Use a session token
   for an OIDC-backed Actual deployment.
2. Add each Up API key under a short connection name. Keys are checked before
   saving. Replace or remove them here without editing YAML or restarting.
3. Refresh accounts and connect each Up account to its Actual destination.
   Shared accounts use one mapping; select both partners' keys for fallback access.

Use **Test** on Actual or an Up connection to check its saved credentials.
Results appear inline without importing bank transactions.

Blank credentials on the Actual edit form retain saved values. Existing keys
are never sent back to the browser. A replacement Up key must still access its
mapped accounts. Remove mappings before removing a key they use, switching
Actual budgets/servers or changing a mapping's destination. Disconnecting keeps
existing Actual transactions; review them before reconnecting elsewhere.

Saving a mapping starts a full backfill when automation is enabled. An unavailable
existing fallback key can be retained if another selected key works. Configuration
changes, connection checks and imports all run through one serial queue.

Actual's API and server must match in major and minor version; connection setup
checks this before saving. The app starts without an upstream connection so the
browser remains available for first-time setup and repairs.

Each Up connection contains its accessible accounts, discovered automatically after
saving a key. **Sync** imports one account; a connection's **Sync All** imports its
mapped accounts; the page-level **Sync All** imports every mapping. A shared
account may appear beneath both connections but retains one mapping and one
import identity. Key settings, mapping edits and backfill controls expand inline.

## Encrypted Storage

`settingsFile` defaults to `/data/settings.json`. The app encrypts credentials,
account IDs and mappings together with AES-256-GCM, a fresh 96-bit nonce per save
and authenticated version context. Files are replaced atomically with mode 0600.
No application database is needed.

`encryptionKeyEnv` defaults to `ACTUAL_UP_ENCRYPTION_KEY`. Supply a randomly
generated secret of at least 32 characters; kubelab generates 48. It is separate
from the app password and never written to the settings file. The encrypted file
is authoritative for browser-managed settings on startup, including CLI commands.
Schedules, note options and category mappings stay in deployment configuration.

Persist and back up `/data/settings.json` and retain its matching encryption key.
Do not simply rotate that key: existing settings will become unreadable. Corrupt,
tampered or incorrectly keyed settings fail startup rather than silently resetting.
Stop the service before restoring a backup or resetting setup by removing the file.
A reset returns to the YAML defaults and requires re-entering saved credentials.
Actual's budget cache is separate and is not encrypted by this settings mechanism.

## Deployment Defaults

- `actual.serverUrl` prefills the Actual setup form; prefer its internal cluster URL.
- `actual.cacheDirectory` defaults to `/data/actual-cache`.
- `up.connections: []` and `mappings: []` start with browser setup.
- Optional preconfigured Up connections use stable `id` and `tokenEnv` references.
- Optional Actual defaults use one of `syncId`/`syncIdEnv` and one of
  `passwordEnv`/`sessionTokenEnv`; `encryptionPasswordEnv` supports encrypted budgets.

Preconfigured environment secrets remain supported for CLI deployments. Replacing
credentials in the browser switches that connection to encrypted app storage.
Aliases are non-sensitive labels used in logs. Each Up and Actual account may
appear in only one mapping. Shared connections follow the displayed fallback order.

`categoryMappings` maps Up category IDs to Actual category IDs. Actual rules run
first; a mapping applies only if a transaction remains uncategorised. The `notes`
flags control create-only enrichment. Existing notes are never overwritten.

## Schedule & Webhooks

`schedule.enabled` defaults to `true`. Mapped accounts are backfilled on startup,
with recent syncs every 15 minutes (`schedule.cron`) and full-history backfills
nightly at 03:00 (`schedule.backfillCron`). The timezone defaults to
`Australia/Sydney`; `lookbackDays` defaults to 30 for recent syncs. No work is
scheduled until at least one account is mapped. Stable import IDs prevent duplicates.
Set `schedule.enabled: false` to disable automatic writes while retaining manual
preview and sync. Restart after changing deployment configuration.

Polling requires no public endpoint. Optional signed webhooks use
`/webhooks/up/:connectionId`, with `webhook.id` and `webhook.secretEnv` configured
on the connection. Keep the UI private. Webhook deliveries and in-memory jobs
are not durable, so retain periodic reconciliation.

## Kubelab & 1Password

The `Actual Up` item in `Cluster: MBK` follows kubelab's existing item reconciliation
and `ClusterSecretStore/onepassword` convention:

| Field            | Environment Variable       | Source                   |
| ---------------- | -------------------------- | ------------------------ |
| `encryption-key` | `ACTUAL_UP_ENCRYPTION_KEY` | Generated by kubelab     |
| `password`       | `ACTUAL_UP_PASSWORD`       | Generated by kubelab     |
| `username`       | `ACTUAL_UP_USERNAME`       | Default `max@excloo.com` |

Existing non-empty fields are preserved. Actual and Up credentials are entered
in the app; the app does not receive a 1Password API credential or vault access.
