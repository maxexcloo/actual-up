import cookie from "@fastify/cookie";
import session from "@fastify/session";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import Fastify, { LogController } from "fastify";
import { LRUCache } from "lru-cache";
import type { Logger } from "pino";
import { z } from "zod";

import { registerActions } from "./actions.js";
import { LoginAttempts } from "./auth.js";
import { environmentValue, type AppConfig } from "./config.js";
import { ConfigError } from "./errors.js";
import type { JobRunner } from "./job-runner.js";
import type { Metrics } from "./metrics.js";
import type { Runtime } from "./runtime.js";
import { encryptionKey } from "./settings-store.js";
import { registerSettings } from "./settings.js";
import { startSchedule } from "./schedule.js";
import type { SyncEngine } from "./sync-engine.js";
import { loginPage } from "./login-ui.js";
import { status, statusVersion } from "./ui.js";

declare module "fastify" {
  interface Session {
    authenticated?: boolean;
  }
}

const sessionCookie = "actual_up_session";
const sessionLifetime = 8 * 60 * 60 * 1000;
const probePaths = new Set(["/livez", "/readyz", "/metrics"]);

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
  const server = await createServer(config, engine, runner, metrics, logger, runtime);
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
  encryptionKey(); // Fail at startup, not on first save, when the key is missing.
  const username = environmentValue("ACTUAL_UP_USERNAME");
  const password = environmentValue("ACTUAL_UP_PASSWORD");
  const attempts = new LoginAttempts(username, password);
  const bundled = (name: string) => readFile(new URL(`../dist/${name}`, import.meta.url), "utf8");
  // The sign-in page loads these before authentication.
  const publicAssets: Record<string, [type: string, body: string]> = {
    "/assets/components.js": ["application/javascript", await bundled("components.js")],
    "/assets/style.css": ["text/css", await bundled("style.css")],
    "/assets/theme.js": ["application/javascript", await bundled("theme.js")],
  };
  const assets = {
    ...publicAssets,
    "/assets/htmx.js": [
      "application/javascript",
      await readFile(createRequire(import.meta.url).resolve("htmx.org/dist/htmx.min.js"), "utf8"),
    ],
  } satisfies typeof publicAssets;
  const publicPaths = new Set(["/login", ...Object.keys(publicAssets)]);
  const server = Fastify({
    bodyLimit: 65_536,
    logController: new LogController({ disableRequestLogging: true }),
    loggerInstance: logger,
    // Run behind one reverse proxy (Kubelab's Traefik); its X-Forwarded-For hop identifies the client.
    trustProxy: (_address, hop) => hop === 0,
  });

  const sessionData = new LRUCache<string, import("fastify").Session>({
    max: 100,
    ttl: sessionLifetime,
  });
  await server.register(cookie);
  await server.register(session, {
    cookie: {
      httpOnly: true,
      path: "/",
      sameSite: "strict",
      secure: config.server.publicUrl?.startsWith("https://") ?? false,
    },
    cookieName: sessionCookie,
    rolling: false,
    saveUninitialized: false,
    secret: randomBytes(32).toString("hex"),
    store: {
      destroy: (id, done) => {
        sessionData.delete(id);
        done();
      },
      get: (id, done) => done(null, sessionData.get(id)),
      set: (id, value, done) => {
        sessionData.set(id, value);
        done();
      },
    },
  });

  // The app only accepts HTML form posts; other bodies are rejected as unsupported.
  server.removeAllContentTypeParsers();
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

  server.get("/livez", async () => ({ status: "ok" }));
  server.get("/readyz", async () => {
    return { status: "ready" };
  });
  server.get("/metrics", async (_request, reply) => {
    reply.header("Content-Type", metrics.registry.contentType);
    return metrics.registry.metrics();
  });

  server.addHook("onRequest", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "same-origin");
    reply.header(
      "Content-Security-Policy",
      "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    );
    const path = request.url.split("?")[0];
    if (probePaths.has(path!)) return;
    if (request.method === "POST") {
      const origin = request.headers.origin;
      const expected = config.server.publicUrl
        ? new URL(config.server.publicUrl).origin
        : `${request.protocol}://${request.host}`;
      if (origin !== expected || request.headers["sec-fetch-site"] === "cross-site") {
        return reply.code(403).send("Request origin does not match this app");
      }
    }
    if (publicPaths.has(path!)) return;
    if (request.session.authenticated !== true) {
      if (request.headers["hx-request"] === "true")
        return reply.header("HX-Redirect", "/login").code(200).send();
      return reply.redirect("/login", 303);
    }
  });

  server.get("/login", async (request, reply) =>
    request.session.authenticated === true
      ? reply.redirect("/", 303)
      : reply.type("text/html").send(loginPage()),
  );
  server.post("/login", async (request, reply) => {
    const parsed = z
      .object({ username: z.string().max(256), password: z.string().max(8192) })
      .strict()
      .safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).type("text/html").send(loginPage("Enter your username and password."));
    const result = attempts.login(parsed.data.username, parsed.data.password, request.ip);
    if (!result.valid)
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
    const now = Date.now();
    await request.session.regenerate();
    request.session.options({ expires: new Date(now + sessionLifetime) });
    request.session.authenticated = true;
    // Save explicitly so HTTPS cookies also work behind the configured TLS proxy.
    await request.session.save();
    return reply.redirect("/", 303);
  });
  server.post("/logout", async (request, reply) => {
    await request.session.destroy();
    return reply.clearCookie(sessionCookie, { path: "/" }).redirect("/login", 303);
  });

  registerSettings(server, config, runner, engine, runtime, logger, makeUpClient);
  registerActions(server, config, runner, engine, runtime);

  server.get<{ Querystring: { version?: string } }>("/runs", async (request, reply) => {
    if (request.query.version === statusVersion(runner)) return reply.code(204).send();
    return reply.type("text/html").send(status(runner, config.schedule));
  });
  for (const [path, [type, body]] of Object.entries(assets))
    server.get(path, async (_request, reply) => reply.type(type).send(body));

  server.setErrorHandler((error: Error & { statusCode?: number }, _request, reply) => {
    // Fastify's own client errors, such as 413 and 415, carry safe messages.
    if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500)
      return reply.code(error.statusCode).send(error.message);
    logger.error(error instanceof ConfigError ? { reason: error.message } : {}, "Request failed");
    return reply.code(500).send("Request failed; check configuration and connectivity");
  });
  return server;
}
