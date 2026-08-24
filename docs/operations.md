# Operations

## Initial setup

1. Deploy the bridge and confirm `/livez` and `/readyz` are healthy.
2. Create Windmill secret variables for the bridge token, Up tokens and webhook
   secrets.
3. Create `f/actual_up/config` using the `actual_up` resource type.
4. Run **Validate**, then **Discover**, from the operator App.
5. Add immutable account and category mappings to the resource.
6. Run a dry run and inspect only the safe counts before running a live sync.
7. Enable `f/actual_up/sync` after the first successful live run.

## Webhooks

The `f/actual_up/manage_webhook` action lists, creates, pings and deletes Up
webhooks. A create result contains a webhook ID and one-time `secretKey`; store
both immediately in `f/actual_up/config` using a secret variable.

The anonymous HTTP route is `/api/r/actual-up/up`. Its preprocessor verifies the
raw Up HMAC signature and webhook identity before passing only safe event IDs to
the reconciliation job. Webhook bodies and signing secrets are never logged.

## Backfills

Run `f/actual_up/sync` with `dryRun: true` and an RFC 3339 or `YYYY-MM-DD`
`since` value. Repeat with `dryRun: false` after reviewing counts. Use the
`accounts` argument to limit a run to selected mapping aliases.

Repeating a range is safe because every Actual import ID is `up:<Up ID>`.

## Deletions and conflicts

Cancelled, unreconciled held transactions are removed automatically. A cleared
transaction with a category, note, split or reconciliation marker is retained
when Up deletes it; the run records a conflict for manual review.

## Monitoring

Windmill provides run history, job logs and schedule state. The operator App
stores the last report at `f/actual_up/status` and shows imported, updated,
inspected, conflict and failure counts. Project logs contain only event names,
connection IDs, configured aliases and status codes—not amounts, payees,
messages, webhook bodies or credentials.

The bridge exposes Prometheus metrics at `/metrics`, including operation totals,
duration and current queue depth. Labels contain only fixed operation names and
outcomes. Configure the chart's `serviceMonitor.enabled` value when Prometheus
Operator is available.

Scheduled reconciliation is the recovery mechanism for missed or interrupted
webhooks.
