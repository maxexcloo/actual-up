# Actual Up

A small private web app that synchronises Up transactions into Actual Budget.
One Node service owns the UI, polling and a serial operation queue. No separate application database or workflow platform.

## Features

- Apply Actual reconciliation and rules, optional category mappings and transfers.
- Check connections and inspect the last 20 runs without exposing transaction
  amounts, payees or messages in logs or run results.
- Import held transactions as uncleared, update settlements and safely handle
  cancelled holds while preserving edits made in Actual.
- Manage connections, API keys and nested account mappings on one page, with
  encrypted credential storage. Sync an account, a connection or everything.
- Preview imports, run a sync, backfill from a date and discover account IDs.
- Serve a responsive default Web Awesome + htmx interface from the same process, with password
  authentication, same-origin checks and a browser-default light/dark toggle.
- Support multiple API keys, personal accounts and shared 2Up accounts. Map each
  bank account once, with partner keys in fallback order; use `up:` import identities.

## Run Locally

Requires Node.js 22.12 or later. Install the pinned tools and dependencies:

```sh
mise run setup
cp config.example.yaml config.local.yaml
```

Set `ACTUAL_UP_USERNAME`, `ACTUAL_UP_PASSWORD` and a random
`ACTUAL_UP_ENCRYPTION_KEY` (at least 32 characters) in your environment, or inject
them with 1Password CLI. Then run:

```sh
mise run dev -- --config ./config.local.yaml
```

Open `http://localhost:3000` and use the app credentials. Open **Accounts & Sync**,
enter your Actual credentials, add Up API keys and connect accounts. Connecting a new mapping automatically backfills
its history when automation is enabled. Editing an existing mapping does not start another backfill. Automatic sync is enabled by default:
a full-history backfill runs on startup and nightly at 03:00, with recent changes
synchronised every 15 minutes. Set `schedule.enabled: false` to pause automation
while using discovery or dry runs.

## Deploy

Kubelab owns the production deployment (`kubelab/apps/base/actual-up`) using
`bjw-s/app-template`, a private route and External Secrets. Its `Actual Up`
1Password item holds the app login and settings encryption key. Merging here
publishes an image but does not deploy it: pin the published tag and digest in
Kubelab to release.

The image runs `serve`, listens on port 3000 and needs writable `/data` and `/tmp`
directories. Persist `/data`: browser settings live in `/data/settings.json`.
Use one replica with `Recreate`; only the Actual cache is rebuildable. Expose the
app through one private HTTPS reverse proxy. The app login and settings
encryption key come from environment variables; upstream credentials are managed
in the browser.

The GitHub Container workflow builds, smoke-tests and scans the image before publishing
to `ghcr.io/maxexcloo/actual-up`. Runtime or build-input changes on `main` publish `latest` and
`sha-<full-commit>`. Version tags such as `v0.1.0` publish `0.1.0` and `0.1`.
Pull requests test and verify the image without publishing. Images include OCI
labels, provenance and an SBOM. Publishing uses the repository’s `GITHUB_TOKEN`;
no registry password is needed.

See [configuration](docs/configuration.md) and [operations](docs/operations.md).

## Development

Install the [shared Mise configuration](https://github.com/maxexcloo/dotfiles#shared-tools--tasks)
before running local Mise tasks.

The UI keeps Web Awesome’s default theme and controls. [Shell styles](assets/shell.css)
own the shared page layout; [app styles](assets/style.css)
contain the removable account and sync layouts. Use Web Awesome’s `--wa-*` tokens
for theme changes rather than overriding individual components.

```sh
mise run check
```

The repository is licensed under AGPL-3.0-only.
