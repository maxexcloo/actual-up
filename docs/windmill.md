# Windmill deployment

The `windmill/` directory is an ordinary Windmill workspace tree. It contains
native TypeScript scripts, the schedule, signed Up HTTP route, custom resource
type and operator App.

## Local CLI profile

Create the ignored `.env.windmill.local`:

```sh
WMILL_URL=https://windmill.example.com
WMILL_WORKSPACE=workspace-id
WMILL_TOKEN=replace-with-a-workspace-token
```

Preview before deploying:

```sh
cd windmill
set -a
source ../.env.windmill.local
set +a
pnpm dlx windmill-cli@1.792.2 sync push --dry-run --yes \
  --base-url "$WMILL_URL" --workspace "$WMILL_WORKSPACE" --token "$WMILL_TOKEN"
```

Deploy by removing `--dry-run`. The schedule is committed disabled so the first
production write remains an explicit operator decision.

## Secrets and resource

Create secret variables such as:

- `f/actual_up/bridge_token`
- `f/actual_up/up_token_max`
- `f/actual_up/up_webhook_secret_max`

Create `f/actual_up/config` as an `actual_up` resource and reference those
variables with `$var:` values. For a bridge in the Windmill namespace, a typical
URL is `http://actual-up.windmill.svc.cluster.local:3000`.

The bridge is the sole Actual writer and serialises every Actual API operation.
Keep the chart at one replica; Windmill may run independent Up fetches in
parallel, but all budget access passes through that single queue.

## Cutover

Keep the legacy daemon stopped but recoverable until validation, discovery, a
dry run, a live run, an Up webhook ping and one scheduled run have all passed.
Only then remove the legacy schedule and webhook endpoint.
