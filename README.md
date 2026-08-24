# actual-up

`actual-up` synchronises Up transactions into Actual Budget. Windmill owns the
schedule, signed webhook endpoint, configuration, run history and operator App.
A small authenticated bridge is the only persistent component because Actual's
official API is a Node package operating on a local SQLite budget cache rather
than an HTTP API.

## Features

- Imports held transactions as uncleared and updates them when they settle.
- Supports multiple Up connections and deduplicates shared 2Up accounts by
  immutable Up account ID.
- Uses Actual import reconciliation and rules, followed by an optional category
  map.
- Maps transfers between configured accounts to Actual transfer payees.
- Mirrors cancelled holds while protecting transactions edited in Actual.
- Provides validation, discovery, dry-run, backfill and webhook-management
  actions in Windmill.
- Includes a Windmill operator App for status, safe results and manual actions.
- Keeps schedules, Up requests, webhook verification and reconciliation in
  native Windmill TypeScript jobs.

The bridge never receives Up credentials or webhook bodies. It exposes only the
Actual operations required by the native jobs, requires a bearer token and
serialises every Actual API call.

## Architecture

```text
Up API/webhooks ──> Windmill native jobs ──> authenticated Actual bridge ──> Actual
                         │
                         ├── schedule and run history
                         ├── secrets and configuration
                         └── operator App
```

Windmill scripts are versioned under [`windmill/`](windmill/). The bridge and
legacy standalone CLI live under [`src/`](src/).

## Local bridge

Copy [`config.bridge.example.yaml`](config.bridge.example.yaml) to
`config.local.yaml`, configure Actual authentication, then run:

```sh
export ACTUAL_UP_BRIDGE_TOKEN='generate-a-long-random-value'
export ACTUAL_PASSWORD='your-actual-server-password'
pnpm bridge --config ./config.local.yaml
```

Check it without exposing the token in the URL:

```sh
curl -H "Authorization: Bearer $ACTUAL_UP_BRIDGE_TOKEN" \
  http://127.0.0.1:3000/v1/version
```

See [Windmill deployment](docs/windmill.md),
[configuration](docs/configuration.md) and [operations](docs/operations.md).

## Kubernetes bridge

The Helm chart runs bridge mode with one replica and a `Recreate` strategy.
Create a Secret containing `ACTUAL_UP_BRIDGE_TOKEN` and the Actual credential
referenced by the configuration, then install:

```sh
helm upgrade --install actual-up ./chart/actual-up \
  --set existingSecret=actual-up \
  --set-file configuration=./config.yaml
```

The cache is rebuildable and uses `emptyDir`; no PVC is required.

## Development

```sh
mise run setup
mise run check
```

Requires Node.js 22 or later. The repository is licensed under AGPL-3.0-only.
