# Configuration

The file is versioned with `version: 1`. Unknown fields are rejected.

## Actual

`actual.serverUrl` and `actual.syncId` select one budget. Set exactly one of `passwordEnv` or `sessionTokenEnv`. `encryptionPasswordEnv` is optional for end-to-end encrypted budget files. `cacheDirectory` defaults to `/data/actual-cache`.

The installed `@actual-app/api` major and minor version must match the Actual server. `validate` reports a clear compatibility error rather than installing packages at runtime.

## Up Connections & Mappings

Each `up.connections` entry has a stable local ID and `tokenEnv`. A configured webhook also has the Up webhook ID and an environment-variable reference for its one-time signing secret.

Each account mapping contains:

- `alias`: a bounded, non-sensitive name used in logs and metrics.
- `upAccountId`: the immutable Up account ID.
- `actualAccountId`: the destination Actual account ID.
- `connections`: tokens that can access the Up account, ordered for scheduled-sync fallback.

An Up or Actual account may be mapped only once. Put both partners' connections on one mapping for a shared account.

## Categories, Notes & Schedule

`categoryMappings` maps Up category IDs to Actual category IDs. Actual rules run first; the mapping applies only if the imported transaction remains uncategorised.

The `notes` flags control create-only enrichment from Up messages, joint-account performers, foreign amounts, cashback and round-ups. Existing Actual notes are never overwritten.

`schedule.cron`, `schedule.timezone` and `schedule.lookbackDays` control reconciliation. The default is every 15 minutes in `Australia/Sydney` with 30 days of overlap.

## Server & Alerts

`server.publicUrl` is required only by `webhook create`. The service listens on `server.host` and `server.port` and exposes `/webhooks/up/:connectionId`, `/livez`, `/readyz` and `/metrics`.

Set `alerts.urlEnv` to send structured failure and conflict events to an automation relay. `cooldownMinutes` suppresses repeated alerts in memory; restarts reset the cooldown.
