# Actual Up

A small private web app that synchronises Up transactions into Actual Budget.

## Run Locally

Requires the Node.js version in `package.json` `engines` and the
[shared Mise configuration](https://github.com/maxexcloo/dotfiles). Install the
dependencies:

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

Open `http://localhost:3000`, sign in with the app credentials and set up Actual,
Up keys and account mappings under **Accounts & Sync**. Optional settings and
their defaults are defined in [src/config.ts](src/config.ts).

## Deploy

Images are published to `ghcr.io/maxexcloo/actual-up`. Tag the matching package
version (for example `v0.1.0`) to publish a versioned image. Kubelab owns
production deployment and provisions the app login and encryption key in the
`Actual Up` item in `Kubelab SYD`; to release, update its image tag.

The image runs `serve` on port 3000 and needs writable `/data` and `/tmp`
directories. Persist `/data`, keep `actual.cacheDirectory` on local storage rather
than NFS, use one replica with `Recreate` updates and serve it behind exactly one
private HTTPS reverse proxy. Set `server.publicUrl` (or `ACTUAL_UP_PUBLIC_URL`) to
the external URL.

`ACTUAL_UP_ENCRYPTION_KEY` must be a random secret of at least 32 characters.

## Operate

- Set `schedule.enabled: false` before adding mappings to preview changes first;
  saving a mapping otherwise starts a backfill.
- Back up `/data/settings.json` together with its encryption key. Changing the
  key makes existing settings unreadable. Stop the service before restoring a
  backup or removing the file to reset setup.
- Rotating the app login needs a rollout after External Secrets refreshes.
- `/metrics` exposes `actual_up_last_success_timestamp_seconds` by trigger; watch
  `schedule` and `automatic-backfill` for unattended imports.
- With the service stopped, the CLI covers maintenance. Never run it alongside
  the service.

```sh
node dist/cli.js --config config.yaml validate
node dist/cli.js --config config.yaml discover
node dist/cli.js --config config.yaml sync --dry-run --since 2026-01-01
```

## Licence

AGPL-3.0 - see [LICENSE](LICENSE).
