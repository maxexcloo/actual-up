# Actual Up

A small private web app that synchronises Up transactions into Actual Budget.
One Node service owns the UI, polling, optional signed webhooks and a serial
operation queue. No separate application database or workflow platform.

## Features

- Preview imports, run a sync, backfill from a date and discover account IDs.
- Check connections and inspect the last 20 runs without exposing transaction
  amounts, payees or messages in logs or run results.
- Import held transactions as uncleared, update settlements and safely handle
  cancelled holds while preserving edits made in Actual.
- Support multiple API keys, personal accounts and shared 2Up accounts. Map each
  bank account once, with partner keys in fallback order; use `up:` import identities.
- Apply Actual reconciliation and rules, optional category mappings and transfers.
- Serve a responsive daisyUI + htmx interface from the same process, with password
  authentication and same-origin checks for actions.

## Run locally

Requires Node.js 22 or later. Install the pinned tools and dependencies:

```sh
mise run setup
cp config.local.example.yaml config.local.yaml
```

Set `ACTUAL_UP_USERNAME`, `ACTUAL_UP_PASSWORD` (at least 16 characters),
`ACTUAL_PASSWORD` and `UP_TOKEN_MAX` in your environment or inject them with
1Password CLI. Set the Actual server URL and budget sync ID in the configuration.
Then run:

```sh
mise exec -- pnpm dev --config ./config.local.yaml
```

Open `http://localhost:3000` and use the app credentials. Discover accounts,
add their IDs to `mappings` and restart. Automatic sync is enabled by default:
a full-history backfill runs on startup and nightly at 03:00, with recent changes
synchronised every 15 minutes. Set `schedule.enabled: false` to pause automation
while using discovery or dry runs.

## Deploy

The image runs `serve`, listens on port 3000 and needs writable `/data` and `/tmp`
directories. Use one replica with `Recreate`; the Actual cache is rebuildable.
Expose the app through private HTTPS. HTTP Basic authentication relies on TLS
outside localhost. Secrets are supplied through environment variables.

The GitHub Container workflow tests, builds and scans the image before publishing
to `ghcr.io/maxexcloo/actual-up`. Pushes to `main` publish `latest` and
`sha-<full-commit>`. Version tags such as `v0.1.0` publish `0.1.0` and `0.1`;
the Git tag must match `package.json`. Pull requests build and scan without
publishing. Images include OCI labels, provenance and an SBOM. Kubelab owns
its deployment using `bjw-s/app-template`, private routing and External Secrets.
Its `Actual Up` 1Password item holds the app login and upstream credentials.
Pin the published image tag and digest in kubelab before enabling the release.
Publishing uses the repository’s `GITHUB_TOKEN`; no registry password is needed.

The included Helm chart is available for installations outside kubelab:

```sh
helm upgrade --install actual-up ./chart/actual-up \
  --set existingSecret=actual-up \
  --set image.repository=ghcr.io/your-owner/actual-up \
  --set image.tag=sha-your-published-commit \
  --set-file configuration=./config.yaml
```

See [configuration](docs/configuration.md) and [operations](docs/operations.md).

## Development

```sh
mise run check
helm lint chart/actual-up --set existingConfigMap=test
helm template test chart/actual-up --set existingConfigMap=test
```

The repository is licensed under AGPL-3.0-only.
