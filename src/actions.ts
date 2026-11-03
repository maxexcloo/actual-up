import type { FastifyInstance } from "fastify";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { Logger } from "pino";

import type { ActionResponse } from "./api.js";
import type { AppConfig } from "./config.js";
import { ConfigError } from "./errors.js";
import type { Runtime } from "./runtime.js";
import { syncForm, testForm } from "./schemas.js";

/** Queue connection tests, syncs and validation from the dashboard. */
export function registerActions(
  server: FastifyInstance<Server, IncomingMessage, ServerResponse, Logger>,
  config: AppConfig,
  { actual, clients, engine, runner }: Runtime,
) {
  server.post("/actions/test", async (request, reply) => {
    const parsed = testForm.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid connection test" });
    const { target, connection } = parsed.data;
    if ((target === "actual" && connection) || (target === "up" && !clients.has(connection)))
      return reply.code(400).send({ error: "Unknown connection" });
    const id = target === "actual" ? "actual" : `up-${connection}`;
    const accepted = runner.enqueue(
      `test:${id}`,
      "test-connection",
      async () => {
        if (target === "actual") await actual.getServerVersion();
        else await clients.get(connection)!.ping();
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

  const queued = (accepted: boolean): ActionResponse =>
    accepted
      ? { accepted, message: "Queued. Follow progress in Sync Status." }
      : { accepted, message: "An action is already queued, or the queue is full. Please wait." };

  server.post("/actions/sync", async (request, reply) => {
    const parsed = syncForm.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]!.message });
    const { account, connection, since, mode } = parsed.data;
    if (
      (account && connection) ||
      (connection && !config.up.connections.some(({ id }) => id === connection))
    )
      return reply.code(400).send({ error: "Unknown connection or ambiguous scope" });
    if (account && !config.mappings.some((mapping) => mapping.alias === account))
      return reply.code(400).send({ error: "Unknown account" });
    const accountId = config.mappings.find((mapping) => mapping.alias === account)?.upAccountId;
    const scope = { account, connection, mode, since };
    const accepted = runner.enqueue(
      `manual:${JSON.stringify(scope)}`,
      mode === "dry-run" ? "dry-run" : since ? "backfill" : "manual",
      async (progress) => {
        const mapping = accountId
          ? config.mappings.find(({ upAccountId }) => upAccountId === accountId)
          : undefined;
        if (accountId && !mapping)
          throw new ConfigError("The account was disconnected before this sync started.");
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
      },
      scope,
    );
    return reply.code(accepted ? 202 : 409).send(queued(accepted));
  });

  server.post("/actions/validate", async (_request, reply) => {
    const accepted = runner.enqueue("manual", "validate", async () => {
      for (const client of clients.values()) await client.ping();
      return { ok: true, ...(await engine.validate()) };
    });
    return reply.code(accepted ? 202 : 409).send(queued(accepted));
  });
}
