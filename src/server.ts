import cookie from "@fastify/cookie";
import session from "@fastify/session";
import { randomBytes } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify, { LogController } from "fastify";
import { LRUCache } from "lru-cache";
import type { Logger } from "pino";

import { registerActions } from "./actions.js";
import { LoginAttempts } from "./auth.js";
import { environmentValue, type AppConfig } from "./config.js";
import { ConfigError } from "./errors.js";
import type { JobRunner } from "./job-runner.js";
import type { Metrics } from "./metrics.js";
import type { Runtime } from "./runtime.js";
import { loginForm } from "./schemas.js";
import { encryptionKey } from "./settings-store.js";
import { registerSettings } from "./settings.js";
import { startSchedule } from "./schedule.js";
import type { SyncEngine } from "./sync-engine.js";

declare module "fastify" {
  interface FastifyRequest {
    styleNonce: string;
  }
  interface Session {
    authenticated?: boolean;
  }
}

const sessionCookie = "actual_up_session";
const sessionLifetime = 8 * 60 * 60 * 1000;
const probePaths = new Set(["/livez", "/readyz", "/metrics"]);
const contentTypes: Record<string, string> = {
  ".css": "text/css",
  ".html": "text/html",
  ".js": "application/javascript",
  ".svg": "image/svg+xml",
  ".txt": "text/plain",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

/** Read the built browser app into memory; it holds no data or credentials. */
async function loadAssets(): Promise<Map<string, [type: string, body: Buffer]>> {
  const root = fileURLToPath(new URL("../dist/public", import.meta.url));
  const assets = new Map<string, [string, Buffer]>();
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    const type = contentTypes[extname(entry.name)];
    if (type) assets.set(`/${relative(root, path)}`, [type, await readFile(path)]);
  }
  return assets;
}

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
  const assets = await loadAssets();
  const index = assets.get("/index.html")?.[1].toString("utf8");
  if (!index) throw new ConfigError("The browser app is missing; run the build first.");
  assets.delete("/index.html");
  // The app shell carries no data, so it loads before sign-in like its assets.
  const shellPaths = new Set(["/", "/login"]);
  const server = Fastify({
    bodyLimit: 65_536,
    logController: new LogController({ disableRequestLogging: true }),
    loggerInstance: logger,
    // Run behind one reverse proxy (Kubelab's Traefik); its X-Forwarded-For hop identifies the client.
    trustProxy: (_address, hop) => hop === 0,
  });

  server.decorateRequest("styleNonce", "");

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

  // The app only accepts JSON bodies; a JSON content type also forces a CORS preflight.
  server.removeAllContentTypeParsers();
  server.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    server.getDefaultJsonParser("error", "error"),
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
    // Mantine writes its CSS variables into one style element, which carries this nonce.
    const nonce = randomBytes(16).toString("base64");
    request.styleNonce = nonce;
    reply.header("Cache-Control", "no-store");
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "same-origin");
    reply.header(
      "Content-Security-Policy",
      `default-src 'none'; script-src 'self'; style-src 'self' 'nonce-${nonce}'; font-src 'self'; connect-src 'self'; img-src 'self' data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`,
    );
    const path = request.url.split("?")[0]!;
    if (probePaths.has(path)) return;
    if (request.method === "POST") {
      const origin = request.headers.origin;
      const expected = config.server.publicUrl
        ? new URL(config.server.publicUrl).origin
        : `${request.protocol}://${request.host}`;
      if (origin !== expected || request.headers["sec-fetch-site"] === "cross-site") {
        return reply.code(403).send({ error: "Request origin does not match this app" });
      }
    }
    if (request.method === "GET" && (shellPaths.has(path) || assets.has(path))) return;
    if (request.method === "POST" && path === "/login") return;
    if (request.session.authenticated !== true)
      return reply.code(401).send({ error: "Sign in to continue" });
  });

  for (const path of shellPaths)
    server.get(path, async (request, reply) =>
      reply.type("text/html").send(index.replaceAll("%STYLE_NONCE%", request.styleNonce)),
    );
  server.post("/login", async (request, reply) => {
    const parsed = loginForm.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: "Enter your username and password." });
    const result = attempts.login(parsed.data.username, parsed.data.password, request.ip);
    if (!result.valid)
      return reply.code(result.limited ? 429 : 401).send({
        error: result.limited
          ? "Too many attempts. Try again in 15 minutes."
          : "Incorrect username or password.",
      });
    const now = Date.now();
    await request.session.regenerate();
    request.session.options({ expires: new Date(now + sessionLifetime) });
    request.session.authenticated = true;
    // Save explicitly so HTTPS cookies also work behind the configured TLS proxy.
    await request.session.save();
    return reply.code(204).send();
  });
  server.post("/logout", async (request, reply) => {
    await request.session.destroy();
    return reply.clearCookie(sessionCookie, { path: "/" }).code(204).send();
  });

  registerSettings(server, config, runner, engine, runtime, logger, makeUpClient);
  registerActions(server, config, runner, engine, runtime);

  for (const [path, [type, body]] of assets)
    server.get(path, async (_request, reply) => {
      // Built asset names contain content hashes, so they never change.
      if (path.startsWith("/assets/"))
        reply.header("Cache-Control", "public, max-age=31536000, immutable");
      return reply.type(type).send(body);
    });

  server.setErrorHandler((error: Error & { statusCode?: number }, _request, reply) => {
    // Fastify's own client errors, such as 413 and 415, carry safe messages.
    if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500)
      return reply.code(error.statusCode).send({ error: error.message });
    logger.error(error instanceof ConfigError ? { reason: error.message } : {}, "Request failed");
    return reply.code(500).send({ error: "Request failed; check configuration and connectivity" });
  });
  return server;
}
