# Actual Up

A small private web app that synchronises Up transactions into Actual Budget.

## Features

- Apply Actual reconciliation and rules, optional category mappings and transfers.
- Import held transactions as uncleared, update them when they settle and handle
  cancelled holds without losing edits made in Actual.
- Connect personal and shared 2Up accounts with multiple API keys and fallback access.
- Preview or sync all accounts or one, backfill from a date and discover account IDs.
- Manage credentials and account mappings in the app with encrypted storage and
  password sign-in. Check connections, recent runs and logs without exposing
  transaction amounts, payees or messages.
- Follow the browser's light/dark preference or choose a theme.

## Run Locally

Requires the Node.js version in `package.json` `engines`. Install the dependencies:

```sh
mise run setup
cp config.example.yaml config.local.yaml
```

`mise run dev` reads `ACTUAL_UP_USERNAME`, `ACTUAL_UP_PASSWORD` and
`ACTUAL_UP_ENCRYPTION_KEY` from the `Actual Up` 1Password item through `fnox.toml`.
Then run:

```sh
mise run dev -- --config ./config.local.yaml
```

Open `http://localhost:3000` and sign in with the app credentials. Open
**Accounts & Sync**, enter your Actual credentials, add Up API keys and connect
accounts.

## Deploy

Images are published to `ghcr.io/maxexcloo/actual-up`. Tag the matching package
version (for example `v0.1.0`) to publish a versioned image.

Kubelab owns production deployment. To release, update its image tag; publishing
an image here does not deploy it. The image runs `serve` on port 3000 and needs
writable `/data` and `/tmp` directories. Persist `/data`, use one replica with
`Recreate` updates and put it behind a private HTTPS reverse proxy.

See [configuration](docs/configuration.md) and [operations](docs/operations.md).

## Development

Install the [shared Mise configuration](https://github.com/maxexcloo/dotfiles#shared-tools--tasks)
before running local Mise tasks.

For UI changes, see the [theme provenance](web/src/vendor/mantinehub/README.md).

```sh
mise run check
```

## Licence

AGPL-3.0 - see [LICENSE](LICENSE).
