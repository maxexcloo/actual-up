# Operations

## Initial Setup

1. Mount configuration and secret environment variables.
2. Run `actual-up validate`.
3. Run `actual-up discover` and confirm every immutable mapping.
4. Start the service and confirm its startup reconciliation succeeds.
5. Create and store each webhook as described below.

## Webhooks

Run the setup command once per connection:

```sh
actual-up webhook create alex
```

The output contains a webhook ID and `secretKey`. Put them in the connection's configuration and referenced Kubernetes Secret, then restart the deployment. The secret cannot be retrieved again from Up.

Use `webhook ping`, `webhook status` and `webhook delete` for lifecycle checks. Only `/webhooks/up` needs public ingress. Invalid signatures and webhook-ID mismatches return `401`; valid events return `200` after being queued.

## Backfills

Preview history before writing:

```sh
actual-up sync --since 2025-01-01 --dry-run
actual-up sync --since 2025-01-01
```

Use `--account joint-spending` to limit a run. Repeating the same range is safe because Up IDs become Actual `imported_id` values.

## Deletions & Conflicts

Cancelled, unreconciled held transactions are removed automatically. A cleared transaction with a category, note, split or reconciliation marker is retained when Up deletes it, and a `delete-conflict` alert is emitted for manual review.

## Monitoring

Readiness becomes available after configuration, Actual and mapping validation. Monitor:

- `actual_up_jobs_total{outcome,trigger}` for failures.
- `actual_up_last_success_timestamp_seconds{trigger}` for stale synchronisation.
- `actual_up_queue_depth` for a blocked worker.
- `actual_up_transactions_total{account,action}` for import and conflict activity.

Metric labels use configured aliases and never financial transaction data. Scheduled reconciliation is the recovery mechanism if a valid webhook job is lost during a crash.
