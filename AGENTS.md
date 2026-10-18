# Project Guidance

## Structure

- `src/` contains the TypeScript service, server-rendered htmx UI and CLI.
- `assets/` contains the default Web Awesome stylesheet and browser helpers, bundled into `dist/`.
- `test/` contains unit and in-memory integration tests.
- `docs/` contains maintained operator documentation.

## Conventions

- Use the default Web Awesome theme and component appearance; keep app CSS limited
  to layout and operational feedback.
- Keep Up and Actual API field names unchanged.
- Treat Up IDs as immutable bank identities and prefix Actual import IDs with `up:`.
- Infer deletions from missing Up IDs only after a full-history read; partial
  transaction windows do not prove deletion.
- Never log transaction amounts, payees, messages or credentials.
- Serialise Actual API access; do not add replicas or parallel budget writers.
- Keep the service configuration-driven with one operation queue and no application database.
- Persist browser settings and credentials together as authenticated ciphertext; keep the encryption key in 1Password.
- Serve UI assets locally; keep credentials on the server and require authentication and same-origin checks for actions.

## Verification

Run `mise run check`.
