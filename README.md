# actual-up

`actual-up` synchronises one household's Up accounts into one Actual Budget file. It accepts signed Up webhooks for low latency and runs overlapping scheduled reconciliation so missed events, restarts and duplicate deliveries do not affect correctness.

## Features

- Imports held transactions as uncleared and updates them when they settle.
- Supports multiple personal access tokens and deduplicates shared 2Up accounts by Up account ID.
- Uses Actual's import reconciliation and rules, then an optional Up-to-Actual category map.
- Maps transfers between configured accounts to Actual transfer payees.
- Mirrors cancelled holds and protects edited Actual transactions from destructive bank deletions.
- Provides explicit backfill, discovery, validation and webhook-management commands.
- Exposes Kubernetes probes, privacy-safe JSON logs, Prometheus metrics and generic alert webhooks.

The service never writes categories or tags back to Up. It has no UI, application database or AI integration.

## Configuration

Copy [`config.example.yaml`](config.example.yaml) and replace every example ID. Configuration contains references to environment variables, not secret values. At minimum, provide an Actual password or session token and one Up personal access token.

```sh
export ACTUAL_PASSWORD='...'
export UP_TOKEN_ALEX='...'
actual-up --config ./config.yaml validate
actual-up --config ./config.yaml discover
```

Account mappings use immutable IDs. A shared account is declared once and may list both partners' connection IDs in fallback order.

See [configuration](docs/configuration.md) for the complete model and [operations](docs/operations.md) for webhooks, backfills and monitoring.

## Run

```sh
pnpm install --frozen-lockfile
pnpm run build
node dist/cli.js --config ./config.yaml serve
```

The default schedule runs every 15 minutes with a 30-day overlap. The service also reconciles once at startup.

For Kubernetes, create a Secret containing the environment variables referenced by the configuration, then install the chart:

```sh
helm upgrade --install actual-up ./chart/actual-up \
  --set existingSecret=actual-up \
  --set-file configuration=./config.yaml
```

The chart deliberately uses one replica and a `Recreate` strategy because the Actual API operates on a local budget cache. The cache is rebuildable and uses `emptyDir`; no PVC is required.

## Development

```sh
mise run setup
mise run check
```

Requires Node.js 22 or later. The repository is licensed under AGPL-3.0-only.
