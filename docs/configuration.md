# Configuration

Configuration is split deliberately: the bridge knows how to reach one Actual
budget, while the Windmill resource knows about Up and how accounts map.

## Actual bridge

The bridge uses the small version 1 YAML configuration shown in
`config.bridge.example.yaml`:

- `actual.serverUrl` and `actual.syncId` select the budget.
- Exactly one of `actual.passwordEnv` or `actual.sessionTokenEnv` authenticates
  to Actual.
- `actual.encryptionPasswordEnv` is optional for encrypted budget files.
- `actual.cacheDirectory` defaults to `/data/actual-cache`.
- `server.host` and `server.port` configure the listener.

Set `ACTUAL_UP_BRIDGE_TOKEN` to a long random secret. Every `/v1` request must
send it as a bearer token. Health endpoints do not require authentication.

Prefer `passwordEnv` for an unattended bridge. It signs in through the official
Actual API, so there is no browser cookie or session token to extract. Point
`serverUrl` at an internal Actual URL that does not present a Cloudflare login
challenge to service-to-service requests.

The installed `@actual-app/api` major and minor version must match the Actual
server. Bridge startup fails before accepting traffic when they differ.

## Windmill resource

Create an `actual_up` resource at `f/actual_up/config`. Its `actual` section has:

- `bridgeUrl`: the bridge URL reachable from Windmill workers.
- `bridgeToken`: preferably a `$var:f/actual_up/bridge_token` secret reference.

Each `up.connections` entry has a stable local ID and token. Store tokens as
secret Windmill variables and use `$var:` references in the resource. A
configured webhook also has the immutable Up webhook ID and its one-time
signing secret.

Each account mapping contains:

- `alias`: a bounded, non-sensitive name used in logs.
- `upAccountId`: the immutable Up account ID.
- `actualAccountId`: the destination Actual account ID.
- `connections`: Up connections that can access the account, in fallback order.

An Up or Actual account may be mapped only once. Put both partners' connections
on one mapping for a shared account.

`categoryMappings` maps Up category IDs to Actual category IDs. Actual rules run
first; the mapping applies only if a transaction remains uncategorised.

The `notes` flags control create-only enrichment from Up messages, joint-account
performers, foreign amounts, cashback and round-ups. Existing Actual notes are
never overwritten.

The Windmill schedule controls cadence. `schedule.lookbackDays` and
`schedule.timezone` configure the reconciliation window and transaction dates.
