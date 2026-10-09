# Project Guidance

## Structure

- `src/` contains the TypeScript service, server-rendered htmx UI and CLI.
- `assets/` contains the Tailwind/daisyUI source stylesheet, compiled into `dist/`.
- `test/` contains unit and in-memory integration tests.
- `chart/actual-up/` contains the Kubernetes Helm chart.
- `docs/` contains maintained operator documentation.

## Conventions

- Keep Up and Actual API field names unchanged.
- Treat Up IDs as immutable bank identities and prefix Actual import IDs with `up:`.
- Never log transaction amounts, payees, messages, webhook bodies or credentials.
- Serialise Actual API access; do not add replicas or parallel budget writers.
- Keep the service configuration-driven with one operation queue and no application database.
- Persist browser settings and credentials together as authenticated ciphertext; keep the encryption key in 1Password.
- Serve UI assets locally; keep credentials on the server and require authentication and same-origin checks for actions.

## Verification

Run `helm lint chart/actual-up --set existingConfigMap=test` and render the chart after template changes.
