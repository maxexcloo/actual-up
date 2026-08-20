import { Cron } from "croner";
import Fastify from "fastify";
import type { Logger } from "pino";

import { environmentValue, type AppConfig } from "./config.js";
import type { JobRunner } from "./job-runner.js";
import type { Metrics } from "./metrics.js";
import type { SyncEngine } from "./sync-engine.js";
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
): Promise<Service> {
  let ready = true;
  const server = Fastify({
    bodyLimit: 1_048_576,
    disableRequestLogging: true,
    loggerInstance: logger,
  });

  server.addContentTypeParser(
    "application/json",
    { parseAs: "buffer" },
    (_request, body, done) => done(null, body),
  );

  server.get("/livez", async () => ({ status: "ok" }));
  server.get("/readyz", async (_request, reply) => {
    if (!ready) return reply.code(503).send({ status: "not-ready" });
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
      runner.enqueue(`webhook:${key}`, "webhook", () =>
        engine.reconcileWebhook(
          connection.id,
          event.data.attributes.eventType,
          transactionId,
        ),
      );
      return reply.code(200).send({ accepted: true });
    },
  );

  const cron = new Cron(
    config.schedule.cron,
    { protect: true, timezone: config.schedule.timezone },
    () => {
      runner.enqueue("schedule", "schedule", () => engine.reconcile());
    },
  );

  await server.listen({ host: config.server.host, port: config.server.port });
  logger.info(
    { nextRun: cron.nextRun()?.toISOString(), port: config.server.port },
    "Service started",
  );

  return {
    async close() {
      ready = false;
      cron.stop();
      await server.close();
      await runner.drain();
    },
  };
}
