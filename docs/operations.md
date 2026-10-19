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

Configuration changes roll the pod through a generated ConfigMap name. App login rotation requires a rollout after External Secrets refreshes.
Up and Actual credential changes apply directly in the browser. Preserve the
settings encryption key; changing it requires re-encrypting or resetting settings. Keep app login and Actual credentials
separate. Health checks confirm the process is serving; use connection checks and
run results to diagnose upstream failures.

## Runs & Recovery

The queue serialises whole operations, including discovery and validation.
Manual syncs with different scopes can queue together; identical scopes and
duplicate scheduled runs coalesce.
It holds at most 32 operations and retains the latest 20 completed results in
memory. Configuration and setup errors are logged with their messages; upstream
Up and Actual errors are reported without their potentially sensitive contents.
An account failure makes the run fail even if other accounts succeeded.

History and queued jobs reset on restart. `/data` uses a persistent volume for
browser settings and the Actual cache. Back up `settings.json`; only the Actual
cache can be rebuilt. Import identities make reconciliation repeatable.
Startup and nightly full-history backfills recover gaps after an extended outage
or interrupted run and confirm deletions. Partial syncs retain transactions absent
from their Up window. Manual backfill remains available. Do not run a
standalone CLI writer alongside the service, or deploy a second instance for the
same budget. Graceful shutdown stops scheduling, closes HTTP and drains the queue;
Kubernetes can still terminate work at the configured grace-period limit.

Metrics are exposed at `/metrics`. `actual_up_jobs_total` records outcomes and
`actual_up_last_success_timestamp_seconds` records successful operations by
trigger. Monitor `schedule` and `automatic-backfill` for unattended imports; a successful
validation or dry run does not prove a scheduled import succeeded.

## CLI

The CLI remains for maintenance while the service is stopped:

```sh
node dist/cli.js --config config.yaml validate
node dist/cli.js --config config.yaml discover
node dist/cli.js --config config.yaml sync --dry-run --since 2026-01-01
node dist/cli.js --config config.yaml sync --since 2026-01-01
```
