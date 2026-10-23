# Operations

## First Run

1. Tag the matching package version (for example `v0.1.0`) to publish a
   versioned image and set that tag in Kubelab.
2. Let Kubelab provision the `Actual Up` 1Password item with app login and
   encryption key. Mappings start empty, so no accounts are imported until
   they are configured.
3. Open the private HTTPS app with the login from 1Password. Use **Accounts & Sync** to enter Actual credentials, add Up keys and save mappings.
4. Saving a mapping automatically backfills it. The app syncs recent
   changes every 15 minutes and backfills nightly. Set `schedule.enabled: false`
   before adding mappings if you want to preview changes first.

Configuration changes roll the pod through a generated ConfigMap name. Rotating
the app login needs a rollout after External Secrets refreshes. Up and Actual
credential changes apply straight away in the browser. Keep the settings
encryption key, because changing it means re-encrypting or resetting settings.
Keep the app login and Actual credentials separate. Health checks only confirm
the process is serving; use connection checks and run results to diagnose
upstream failures.

## Runs & Recovery

The queue serialises whole operations, including discovery and validation.
Manual syncs with different scopes can queue together, while identical scopes and
duplicate scheduled runs are merged. It holds at most 32 operations and keeps the
latest 20 completed results in memory. Configuration and setup errors are logged with their messages; upstream
Up and Actual errors are reported without their potentially sensitive contents.
An account failure makes the run fail even if other accounts succeeded.

History and queued jobs reset on restart. Kubelab persists browser settings in
`/data/settings.json`; the rebuildable Actual cache defaults to ephemeral
`/tmp/actual-cache`. Back up `settings.json`. Import identities make
reconciliation repeatable.
Startup and nightly full-history backfills recover gaps after an extended outage
or interrupted run and confirm deletions. Partial syncs keep transactions that fall outside their Up window. Manual
backfill is still available. Don't run a standalone CLI writer alongside the
service or deploy a second instance for the same budget. Graceful shutdown stops scheduling, closes HTTP and drains the queue;
Kubernetes can still terminate work at the configured grace-period limit.

Metrics are exposed at `/metrics`. `actual_up_jobs_total` records outcomes and
`actual_up_last_success_timestamp_seconds` records successful operations by
trigger. Watch `schedule` and `automatic-backfill` for unattended imports. A successful
validation or dry run doesn't prove a scheduled import worked.

## CLI

The CLI is still there for maintenance while the service is stopped:

```sh
node dist/cli.js --config config.yaml validate
node dist/cli.js --config config.yaml discover
node dist/cli.js --config config.yaml sync --dry-run --since 2026-01-01
node dist/cli.js --config config.yaml sync --since 2026-01-01
```
