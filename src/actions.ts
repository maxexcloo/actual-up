import type { FastifyInstance } from "fastify";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { Logger } from "pino";

import type { ActionResponse } from "./api.js";
import type { AppConfig } from "./config.js";
import { ConfigError } from "./errors.js";
import type { Runtime } from "./runtime.js";
import { syncForm } from "./schemas.js";

/** Queue syncs and connection checks from the dashboard. */
export function registerActions(
  server: FastifyInstance<Server, IncomingMessage, ServerResponse, Logger>,
  config: AppConfig,
  { clients, engine, runner }: Runtime,
) {
  const queued = (accepted: boolean): ActionResponse =>
    accepted
      ? { accepted, message: "Queued. Follow progress in Sync Status." }
      : { accepted, message: "An action is already queued, or the queue is full. Please wait." };

  server.post("/actions/sync", async (request, reply) => {
    const parsed = syncForm.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]!.message });
    const { account, since, mode } = parsed.data;
    const accountId = config.mappings.find((mapping) => mapping.alias === account)?.upAccountId;
    if (account && !accountId) return reply.code(400).send({ error: "Unknown account" });
    const scope = { account, mode, since };
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
          mappingAliases: mapping ? [mapping.alias] : undefined,
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
