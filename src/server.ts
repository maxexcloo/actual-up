import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import Fastify, { LogController } from "fastify";
import type { Logger } from "pino";
import { z } from "zod";

import { Sessions } from "./auth.js";
import { environmentValue, type AppConfig } from "./config.js";
import type { JobRunner } from "./job-runner.js";
import type { Metrics } from "./metrics.js";
import { assertActualCompatibility, type Runtime } from "./runtime.js";
import { checkEncryptionKey } from "./settings-store.js";
import { registerSettings } from "./settings.js";
import { startSchedule } from "./schedule.js";
import type { SyncEngine } from "./sync-engine.js";
import { loginPage } from "./login-ui.js";
import { dashboard, status, statusVersion } from "./ui.js";
import { parseWebhook, verifyWebhookSignature } from "./webhook.js";

export type Service = {
  close(): Promise<void>;
};

export async function startService(
  config: AppConfig,
  engine: SyncEngine,
  runner: JobRunner,
  metrics: Metrics,
  logger: Logger,
  runtime: Pick<Runtime, "actual" | "clients">,
): Promise<Service> {
  const server = await createServer(
    config,
    engine,
    runner,
    metrics,
    logger,
    runtime,
  );
  await server.listen({ host: config.server.host, port: config.server.port });
  const stopSchedule = startSchedule(config, engine, runner, runtime.actual);
  logger.info({ port: config.server.port }, "Service started");
  return {
    async close() {
      stopSchedule();
      await server.close();
      await runner.close();
    },
  };
}

export async function createServer(
  config: AppConfig,
  engine: SyncEngine,
  runner: JobRunner,
  metrics: Metrics,
  logger: Logger,
  runtime: Pick<Runtime, "actual" | "clients">,
  makeUpClient?: Parameters<typeof registerSettings>[6],
) {
  checkEncryptionKey(config);
  const username = environmentValue(config.auth.usernameEnv);
  const password = environmentValue(config.auth.passwordEnv);
  const sessions = new Sessions(
    username,
    password,
    config.server.publicUrl?.startsWith("https://") ?? false,
  );
  const htmx = await readFile(
    createRequire(import.meta.url).resolve("htmx.org/dist/htmx.min.js"),
    "utf8",
  );
  const stylesheet = await readFile(
    new URL("../dist/style.css", import.meta.url),
    "utf8",
  );
  const server = Fastify({
    bodyLimit: 65_536,
    logController: new LogController({ disableRequestLogging: true }),
    loggerInstance: logger,
  });

  server.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string" },
    (_request, body, done) => {
      const values = new URLSearchParams(String(body));
      done(
        null,
        Object.fromEntries(
          [...new Set(values.keys())].map((key) => {
            const entries = values.getAll(key);
            return [key, entries.length > 1 ? entries : entries[0]];
          }),
        ),
      );
    },
  );

  server.addContentTypeParser(
    "application/json",
    { parseAs: "buffer" },
    (_request, body, done) => done(null, body),
  );

  server.get("/livez", async () => ({ status: "ok" }));
  server.get("/readyz", async () => {
    return { status: "ready" };
  });
  server.get("/metrics", async (_request, reply) => {
    reply.header("Content-Type", metrics.registry.contentType);
    return metrics.registry.metrics();
  });

  server.post<{ Params: { connectionId: string } }>(
    "/webhooks/up/:connectionId",
    async (request, reply) => {
      const connection = config.up.connections.find(
        ({ id }) => id === request.params.connectionId,
      );
      if (!connection?.webhook)
        return reply.code(404).send({ error: "unknown webhook" });
      const body = request.body;
      if (!Buffer.isBuffer(body))
        return reply.code(400).send({ error: "invalid body" });
      const header = request.headers["x-up-authenticity-signature"];
      const signature = Array.isArray(header) ? header[0] : header;
      if (
        !verifyWebhookSignature(
          body,
          signature,
          environmentValue(connection.webhook.secretEnv),
        )
      ) {
        return reply.code(401).send({ error: "invalid signature" });
      }
      let event: ReturnType<typeof parseWebhook>;
      try {
        event = parseWebhook(body);
      } catch {
        return reply.code(400).send({ error: "invalid event" });
      }
      if (event.data.relationships.webhook.data.id !== connection.webhook.id) {
        return reply.code(401).send({ error: "webhook mismatch" });
      }
      const transactionId = event.data.relationships.transaction?.data?.id;
      const key = transactionId ?? event.data.id;
      const accepted = runner.enqueue(
        `webhook:${key}:${event.data.attributes.eventType}`,
        "webhook",
        async () => {
          await runtime.actual.sync();
          return engine.reconcileWebhook(
            connection.id,
            event.data.attributes.eventType,
            transactionId,
          );
        },
      );
      if (!accepted)
        return reply.code(503).send({ error: "queue busy; retry" });
      return reply.code(200).send({ accepted: true });
    },
  );

  server.addHook("onRequest", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "same-origin");
    reply.header(
      "Content-Security-Policy",
      "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    );
    const path = request.url.split("?")[0];
    if (
      ["/livez", "/readyz", "/metrics"].includes(path!) ||
      path?.startsWith("/webhooks/up/")
    )
      return;
    if (request.method === "POST") {
      const origin = request.headers.origin;
      const expected = config.server.publicUrl
        ? new URL(config.server.publicUrl).origin
        : `${request.protocol}://${request.host}`;
      if (
        origin !== expected ||
        request.headers["sec-fetch-site"] === "cross-site"
      ) {
        return reply.code(403).send("Request origin does not match this app");
      }
    }
    if (path === "/login" || path === "/assets/style.css") return;
    if (!sessions.valid(request.headers.cookie)) {
      if (request.headers["hx-request"] === "true")
        reply.header("HX-Redirect", "/login");
      return reply.redirect("/login", 303);
    }
  });

  server.get("/login", async (request, reply) =>
    sessions.valid(request.headers.cookie)
      ? reply.redirect("/", 303)
      : reply.type("text/html").send(loginPage()),
  );
  server.post("/login", async (request, reply) => {
    const parsed = z
      .object({ username: z.string().max(256), password: z.string().max(8192) })
      .strict()
      .safeParse(request.body);
    if (!parsed.success)
      return reply
        .code(400)
        .type("text/html")
        .send(loginPage("Enter your username and password."));
    const result = sessions.login(
      parsed.data.username,
      parsed.data.password,
      request.ip,
    );
    if (!result.cookie)
      return reply
        .code(result.limited ? 429 : 401)
        .type("text/html")
        .send(
          loginPage(
            result.limited
              ? "Too many attempts. Try again in 15 minutes."
              : "Incorrect username or password.",
          ),
        );
    sessions.logout(request.headers.cookie);
    return reply.header("Set-Cookie", result.cookie).redirect("/", 303);
  });
  server.post("/logout", async (request, reply) =>
    reply
      .header("Set-Cookie", sessions.logout(request.headers.cookie))
      .redirect("/login", 303),
  );

  registerSettings(
    server,
    config,
    runner,
    engine,
    runtime,
    logger,
    makeUpClient,
  );

  server.get("/", async (_request, reply) =>
    reply.type("text/html").send(dashboard(config, runner)),
  );
  server.get<{ Querystring: { version?: string } }>(
    "/runs",
    async (request, reply) => {
      if (request.query.version === statusVersion(runner))
        return reply.code(204).send();
      return reply
        .type("text/html")
        .send(status(runner, config.schedule.timezone));
    },
  );
  server.get("/assets/style.css", async (_request, reply) =>
    reply.type("text/css").send(stylesheet),
  );
  server.get("/assets/htmx.js", async (_request, reply) =>
    reply.type("application/javascript").send(htmx),
  );

  server.post<{ Params: { action: string } }>(
    "/actions/:action",
    async (request, reply) => {
      const action = request.params.action;
      let operation: () => Promise<unknown>;
      let trigger = action;
      if (action === "sync") {
        const parsed = z
          .object({
            mode: z.enum(["dry-run", "live"]),
            account: z.string().default(""),
            since: z.string().default(""),
          })
          .strict()
          .safeParse(request.body);
        if (!parsed.success) return reply.code(400).send("Invalid action");
        const { account, since, mode } = parsed.data;
        if (
          account &&
          !config.mappings.some((mapping) => mapping.alias === account)
        )
          return reply.code(400).send("Unknown account");
        if (
          since &&
          (!/^\d{4}-\d{2}-\d{2}$/.test(since) ||
            !Number.isFinite(Date.parse(since)) ||
            new Date(since).toISOString().slice(0, 10) !== since ||
            since > new Date().toISOString().slice(0, 10))
        )
          return reply.code(400).send("Choose a valid date in the past");
        trigger =
          mode === "dry-run" ? "dry-run" : since ? "backfill" : "manual";
        operation = async () => {
          await runtime.actual.sync();
          return engine.reconcile({
            dryRun: mode === "dry-run",
            mappingAliases: account ? [account] : undefined,
            since: since || undefined,
          });
        };
      } else if (action === "validate") {
        operation = async () => {
          for (const client of runtime.clients.values()) await client.ping();
          const result = await engine.validate();
          assertActualCompatibility(result.actualVersion);
          return { ok: true, ...result };
        };
      } else if (action === "discover") {
        operation = async () => {
          const up = [];
          for (const [connection, client] of runtime.clients) {
            const accounts = await client.listAccounts();
            up.push({
              connection,
              accounts: accounts.map(({ id, attributes }) => ({
                id,
                name: attributes.displayName,
              })),
            });
          }
          const accounts = (await runtime.actual.getAccounts()).map(
            ({ id, name }) => ({ id, name }),
          );
          const categories = (await runtime.actual.getCategories()).map(
            ({ id, name }) => ({ id, name }),
          );
          return { actual: { accounts, categories }, up };
        };
      } else {
        return reply.code(404).send("Unknown action");
      }
      const accepted = runner.enqueue("manual", trigger, operation);
      if (request.headers["hx-request"] !== "true")
        return reply.redirect("/", 303);
      return reply
        .header("HX-Trigger", "refresh-status")
        .type("text/html")
        .send(
          accepted
            ? "Queued. Follow progress in recent activity above."
            : "An action is already queued, or the queue is full. Please wait.",
        );
    },
  );
  server.setErrorHandler((_error, _request, reply) => {
    logger.error("Request failed");
    return reply
      .code(500)
      .send("Request failed; check configuration and connectivity");
  });
  return server;
}
