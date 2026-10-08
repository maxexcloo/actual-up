# Operations

## First run

1. Push `main` to publish a commit-tagged image, or tag the matching package
   version (for example `v0.1.0`) to publish a versioned image. Pin the resulting
   tag and digest in kubelab.
2. Let kubelab provision the `Actual Up` 1Password item with app login and
   encryption key.
3. Unsuspend the prepared Helm release when ready to configure it. Mappings
   start empty, so no accounts are imported until they are configured.
4. Open the private HTTPS app with the login from 1Password. Use **Accounts &
   Connections** to enter Actual credentials, add Up keys and save mappings.
5. Saving a mapping automatically backfills it. The app syncs recent
   changes every 15 minutes and backfills nightly. Set `schedule.enabled: false`
   before adding mappings if you want to preview changes first.

Configuration changes roll the pod through a generated ConfigMap name. App login rotation requires a rollout after External Secrets refreshes.
Up and Actual credential changes apply directly in the browser. Preserve the
settings encryption key; changing it requires re-encrypting or resetting settings. Keep app login and Actual credentials
separate. Health checks confirm the process is serving; use connection checks and
run results to diagnose upstream failures.

## Runs and recovery

The queue serialises whole operations, including discovery and validation. Only
one manual action can be queued at a time; duplicate scheduled runs coalesce.
It holds at most 32 operations and retains the latest 20 completed results in
memory. Exceptions are reported without their potentially sensitive contents.
An account failure makes the run fail even if other accounts succeeded.

History and queued jobs reset on restart. `/data` uses a persistent volume for
browser settings and the Actual cache. Back up `settings.json`; only the Actual
cache can be rebuilt. The chart creates a 1Gi claim by default, or accepts
`persistence.existingClaim` and `persistence.storageClass`. Import identities make reconciliation repeatable.
Startup and nightly full-history backfills recover gaps after an extended outage
or interrupted run. Manual backfill remains available. Do not run a
standalone CLI writer alongside the service, or deploy a second instance for the
same budget. Graceful shutdown stops scheduling, closes HTTP and drains the queue;
Kubernetes can still terminate work at the configured grace-period limit.

Metrics are exposed at `/metrics`. `actual_up_jobs_total` records outcomes and
`actual_up_last_success_timestamp_seconds` records successful operations by
trigger. Monitor `schedule` and `automatic-backfill` for unattended imports; a successful
validation or dry run does not prove a scheduled import succeeded.

## Windmill migration

The duplicate Windmill scripts and bridge have been removed from this repository.
This does not delete deployed Windmill resources. Before enabling this app's
writer, disable any existing Windmill schedule and webhook trigger and stop its
bridge. Validate, preview, import and observe a scheduled run before deleting the
old deployment. Leave Windmill available for other workloads.

## CLI

The CLI remains for maintenance while the service is stopped:

```sh
node dist/cli.js --config config.yaml validate
node dist/cli.js --config config.yaml discover
node dist/cli.js --config config.yaml sync --dry-run --since 2026-01-01
node dist/cli.js --config config.yaml sync --since 2026-01-01
```

Optional webhook management is available through `webhook create`, `delete`,
`ping` and `status`. Creation prints a one-time secret for secure storage; do not
capture that output in CI or shared logs.
