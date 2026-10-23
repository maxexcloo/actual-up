import type { FastifyInstance } from "fastify";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { Logger } from "pino";

import type { ActionResponse } from "./api.js";
import type { AppConfig } from "./config.js";
import { discoverActualAccounts, discoverUpAccounts } from "./discovery.js";
import { ConfigError } from "./errors.js";
import type { JobRunner } from "./job-runner.js";
import { assertActualCompatibility } from "./actual-version.js";
import type { Runtime } from "./runtime.js";
import { syncForm, testForm } from "./schemas.js";
import type { SyncEngine } from "./sync-engine.js";

/** Queue connection tests, syncs, validation and discovery from the dashboard. */
export function registerActions(
  server: FastifyInstance<Server, IncomingMessage, ServerResponse, Logger>,
  config: AppConfig,
  runner: JobRunner,
  engine: SyncEngine,
  runtime: Pick<Runtime, "actual" | "clients">,
) {
  server.post("/actions/test", async (request, reply) => {
    const parsed = testForm.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid connection test" });
    const { target, connection } = parsed.data;
    if (
      (target === "actual" && connection) ||
      (target === "up" && !runtime.clients.has(connection))
    )
      return reply.code(400).send({ error: "Unknown connection" });
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
    // A duplicate request joins the test that is already queued or running.
    const pending = runner.history.some(
      (job) =>
        job.trigger === "test-connection" &&
        job.scope?.target === id &&
        (job.state === "queued" || job.state === "running"),
    );
    const response: ActionResponse =
      accepted || pending
        ? { accepted: true, message: "Testing connection…" }
        : { accepted: false, message: "The queue is busy. Try again shortly." };
    return reply.code(response.accepted ? 202 : 409).send(response);
  });

  server.post<{ Params: { action: string } }>("/actions/:action", async (request, reply) => {
    const action = request.params.action;
    let operation: Parameters<JobRunner["enqueue"]>[2];
    let scope: Parameters<JobRunner["enqueue"]>[3];
    let queueKey = "manual";
    let trigger = action;
    if (action === "sync") {
      const parsed = syncForm.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Invalid action" });
      const { account, connection, since, mode } = parsed.data;
      if (
        (account && connection) ||
        (connection && !config.up.connections.some(({ id }) => id === connection))
      )
        return reply.code(400).send({ error: "Unknown connection or ambiguous scope" });
      if (account && !config.mappings.some((mapping) => mapping.alias === account))
        return reply.code(400).send({ error: "Unknown account" });
      const accountId = config.mappings.find((mapping) => mapping.alias === account)?.upAccountId;
      if (
        since &&
        (!/^\d{4}-\d{2}-\d{2}$/.test(since) ||
          !Number.isFinite(Date.parse(since)) ||
          new Date(since).toISOString().slice(0, 10) !== since ||
          since > new Date().toISOString().slice(0, 10))
      )
        return reply.code(400).send({ error: "Choose a valid date in the past" });
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
      return reply.code(404).send({ error: "Unknown action" });
    }
    const accepted = runner.enqueue(queueKey, trigger, operation, scope);
    const response: ActionResponse = accepted
      ? { accepted, message: "Queued. Follow progress in Sync Status." }
      : { accepted, message: "An action is already queued, or the queue is full. Please wait." };
    return reply.code(accepted ? 202 : 409).send(response);
  });
}
