# Actual Up

A small private web app that synchronises Up transactions into Actual Budget.
One Node service runs the UI, polling and a serial operation queue, so there's
no separate application database or workflow platform.

## Features

- Apply Actual reconciliation and rules, optional category mappings and transfers.
- Check connections and inspect the last 20 runs. Transaction amounts, payees
  and messages stay out of logs and run results.
- Import held transactions as uncleared, update them when they settle and handle
  cancelled holds without losing edits made in Actual.
- Manage connections, API keys and nested account mappings on one page, with
  encrypted credential storage. Sync an account, a connection or everything.
- Preview imports, run a sync, backfill from a date and discover account IDs.
- Serve a responsive Web Awesome + htmx interface from the same process, using
  the default theme, with password sign-in, same-origin checks and a light/dark
  toggle that follows the browser by default.
- Support multiple API keys, personal accounts and shared 2Up accounts. Each bank
  account is mapped once, with partner keys in fallback order, and imported with
  an `up:` identity.

## Run Locally

Requires the Node.js version in `package.json` `engines`. Install the dependencies:

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

Open `http://localhost:3000` and sign in with the app credentials. Open
**Accounts & Sync**, enter your Actual credentials, add Up API keys and connect
accounts. When automation is on, connecting a new mapping backfills its history;
editing an existing mapping doesn't start another backfill. Automatic sync is on
by default. A full-history backfill runs on startup and nightly at 03:00, and
recent changes sync every 15 minutes. Set `schedule.enabled: false` to pause
automation while you use discovery or dry runs.

## Deploy

Production runs from Kubelab (`kubelab/apps/base/actual-up`) using
`bjw-s/app-template`, a private route and External Secrets. Its `Actual Up`
1Password item holds the app login and settings encryption key. Merging here
publishes an image but doesn't deploy it. To release, update the image tag in
Kubelab.

The image runs `serve`, listens on port 3000 and needs writable `/data` and `/tmp`
directories. Persist `/data`, since browser settings live in
`/data/settings.json`. Use one replica with `Recreate`; only the Actual cache can
be rebuilt. Put the app behind one private HTTPS reverse proxy. The app login and
settings encryption key come from environment variables, and upstream
credentials are managed in the browser.

The GitHub Container workflow builds, smoke-tests and scans the image before
publishing it to `ghcr.io/maxexcloo/actual-up`. Pushes to `main` other than
Markdown-only changes publish `latest` and `sha-<full-commit>`. Version tags such as `v0.1.0`
publish `0.1.0` and `0.1`. Pull requests test and verify the image without
publishing it. Images include OCI labels, provenance and an SBOM. Publishing uses
the repository's `GITHUB_TOKEN`, so no registry password is needed.

See [configuration](docs/configuration.md) and [operations](docs/operations.md).

## Development

Install the [shared Mise configuration](https://github.com/maxexcloo/dotfiles#shared-tools--tasks)
before running local Mise tasks.

The UI uses Web Awesome's default theme and controls. [Shell styles](assets/shell.css)
hold the shared page layout and [app styles](assets/style.css) hold the
removable account and sync layouts. For theme changes, use Web Awesome's `--wa-*`
tokens instead of overriding individual components.

```sh
mise run check
```

The repository is licensed under AGPL-3.0-only.
