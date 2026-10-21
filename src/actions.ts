import type { FastifyInstance } from "fastify";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { Logger } from "pino";
import { z } from "zod";

import type { AppConfig } from "./config.js";
import { discoverActualAccounts, discoverUpAccounts } from "./discovery.js";
import { ConfigError } from "./errors.js";
import type { JobRunner } from "./job-runner.js";
import { assertActualCompatibility, type Runtime } from "./runtime.js";
import type { SyncEngine } from "./sync-engine.js";
import { connectionTestStatus } from "./ui.js";

/** Queue connection tests, syncs, validation and discovery from the dashboard. */
export function registerActions(
  server: FastifyInstance<Server, IncomingMessage, ServerResponse, Logger>,
  config: AppConfig,
  runner: JobRunner,
  engine: SyncEngine,
  runtime: Pick<Runtime, "actual" | "clients">,
) {
  const connectionTest = (target: string) =>
    runner.history.find((job) => job.trigger === "test-connection" && job.scope?.target === target);
  server.get<{ Params: { target: string } }>(
    "/connection-tests/:target",
    async (request, reply) => {
      const job = connectionTest(request.params.target);
      if (!job) return reply.code(404).send("Unknown connection test");
      return reply.type("text/html").send(connectionTestStatus(request.params.target, job.state));
    },
  );
  server.post("/actions/test", async (request, reply) => {
    const parsed = z
      .object({
        target: z.enum(["actual", "up"]),
        connection: z.string().default(""),
      })
      .strict()
      .safeParse(request.body);
    if (!parsed.success) return reply.code(400).send("Invalid connection test");
    const { target, connection } = parsed.data;
    if (
      (target === "actual" && connection) ||
      (target === "up" && !runtime.clients.has(connection))
    )
      return reply.code(400).send("Unknown connection");
    const id = target === "actual" ? "actual" : `up-${connection}`;
    const accepted = runner.enqueue(
      `test:${id}`,
      "test-connection",
      async () => {
        if (target === "actual") assertActualCompatibility(await runtime.actual.getServerVersion());
        else await runtime.clients.get(connection)!.ping();
        return { ok: true };
      },
      { target: id },
    );
    const state = connectionTest(id)?.state;
    if (request.headers["hx-request"] !== "true") return reply.redirect("/", 303);
    return reply
      .header("HX-Trigger", "refresh-status")
      .type("text/html")
      .send(
        connectionTestStatus(
          id,
          accepted || state === "queued" || state === "running" ? state : "busy",
        ),
      );
  });

  server.post<{ Params: { action: string } }>("/actions/:action", async (request, reply) => {
    const action = request.params.action;
    let operation: Parameters<JobRunner["enqueue"]>[2];
    let scope: Parameters<JobRunner["enqueue"]>[3];
    let queueKey = "manual";
    let trigger = action;
    if (action === "sync") {
      const parsed = z
        .object({
          mode: z.enum(["dry-run", "live"]),
          account: z.string().default(""),
          connection: z.string().default(""),
          since: z.string().default(""),
        })
        .strict()
        .safeParse(request.body);
      if (!parsed.success) return reply.code(400).send("Invalid action");
      const { account, connection, since, mode } = parsed.data;
      if (
        (account && connection) ||
        (connection && !config.up.connections.some(({ id }) => id === connection))
      )
        return reply.code(400).send("Unknown connection or ambiguous scope");
      if (account && !config.mappings.some((mapping) => mapping.alias === account))
        return reply.code(400).send("Unknown account");
      const accountId = config.mappings.find((mapping) => mapping.alias === account)?.upAccountId;
      if (
        since &&
        (!/^\d{4}-\d{2}-\d{2}$/.test(since) ||
          !Number.isFinite(Date.parse(since)) ||
          new Date(since).toISOString().slice(0, 10) !== since ||
          since > new Date().toISOString().slice(0, 10))
      )
        return reply.code(400).send("Choose a valid date in the past");
      trigger = mode === "dry-run" ? "dry-run" : since ? "backfill" : "manual";
      scope = { account, connection, mode, since };
      queueKey = `manual:${JSON.stringify(scope)}`;
      operation = async (progress) => {
        const mapping = accountId
          ? config.mappings.find(({ upAccountId }) => upAccountId === accountId)
          : undefined;
        if (accountId && !mapping)
          throw new ConfigError("The account was disconnected before this sync started.");
        progress({ stage: "Refresh Actual" });
        await runtime.actual.sync();
        return engine.reconcile({
          dryRun: mode === "dry-run",
          mappingAliases: mapping
            ? [mapping.alias]
            : connection
              ? config.mappings
                  .filter(({ connections }) => connections.includes(connection))
                  .map(({ alias }) => alias)
              : undefined,
          since: since || undefined,
          progress,
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
          up.push({
            connection,
            accounts: await discoverUpAccounts(client),
          });
        }
        const accounts = await discoverActualAccounts(runtime.actual);
        const categories = (await runtime.actual.getCategories()).map(({ id, name }) => ({
          id,
          name,
        }));
        return { up, actual: { accounts, categories } };
      };
    } else {
      return reply.code(404).send("Unknown action");
    }
    const accepted = runner.enqueue(queueKey, trigger, operation, scope);
    if (request.headers["hx-request"] !== "true") return reply.redirect("/", 303);
    return reply
      .header("HX-Trigger", "refresh-status")
      .type("text/html")
      .send(
        accepted
          ? "Queued. Follow progress in Sync Status."
          : "An action is already queued, or the queue is full. Please wait.",
      );
  });
}
