import { createHash, timingSafeEqual } from "node:crypto";

import Fastify, { LogController } from "fastify";
import type { Logger } from "pino";
import { Counter, Gauge, Histogram, Registry } from "prom-client";
import { z } from "zod";

import type { ActualClient } from "./types.js";

const identifier = z.string().min(1).max(200);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const importTransaction = z.object({
  account: identifier,
  amount: z.number().int(),
  category: identifier.optional(),
  cleared: z.boolean(),
  date,
  imported_id: z.string().min(1).max(300),
  imported_payee: z.string().max(500),
  notes: z.string().max(10_000).optional(),
  payee: identifier.nullable().optional(),
  payee_name: z.string().max(500).optional(),
});
const actualTransactionFields = z
  .object({
    account: identifier.optional(),
    amount: z.number().int().optional(),
    category: identifier.optional(),
    cleared: z.boolean().optional(),
    date: date.optional(),
    imported_id: z.string().max(300).optional(),
    imported_payee: z.string().max(500).optional(),
    notes: z.string().max(10_000).optional(),
    payee: identifier.nullable().optional(),
    reconciled: z.boolean().optional(),
  })
  .strict();

export function createBridgeServer(
  actual: ActualClient,
  token: string,
  logger: Logger,
) {
  const server = Fastify({
    bodyLimit: 1_048_576,
    logController: new LogController({ disableRequestLogging: true }),
    loggerInstance: logger,
  });
  const metrics = new BridgeMetrics();
  const serial = new SerialExecutor(metrics);

  server.get("/livez", async () => ({ status: "ok" }));
  server.get("/readyz", async () => ({ status: "ready" }));
  server.get("/metrics", async (_request, reply) => {
    reply.header("Content-Type", metrics.registry.contentType);
    return metrics.registry.metrics();
  });

  server.register(
    async (api) => {
      api.addHook("onRequest", async (request, reply) => {
        const provided = request.headers.authorization;
        if (
          !provided?.startsWith("Bearer ") ||
          !tokensMatch(provided.slice(7), token)
        ) {
          return reply.code(401).send({ error: "unauthorised" });
        }
      });

      api.get("/version", async () =>
        serial.run("version", () => actual.getServerVersion()),
      );
      api.get("/accounts", async () =>
        serial.run("accounts", () => actual.getAccounts()),
      );
      api.get("/categories", async () =>
        serial.run("categories", () => actual.getCategories()),
      );
      api.get("/payees", async () =>
        serial.run("payees", () => actual.getPayees()),
      );

      api.post("/transactions/query", async (request, reply) => {
        const parsed = z
          .object({ accountId: identifier, endDate: date, startDate: date })
          .safeParse(request.body);
        if (!parsed.success)
          return reply.code(400).send({ error: "invalid request" });
        return serial.run("transactions-query", () =>
          actual.getTransactions(
            parsed.data.accountId,
            parsed.data.startDate,
            parsed.data.endDate,
          ),
        );
      });

      api.post("/transactions/import", async (request, reply) => {
        const parsed = z
          .object({ accountId: identifier, transaction: importTransaction })
          .safeParse(request.body);
        if (!parsed.success)
          return reply.code(400).send({ error: "invalid request" });
        return serial.run("transactions-import", () =>
          actual.importTransaction(
            parsed.data.accountId,
            parsed.data.transaction,
          ),
        );
      });

      api.patch("/transactions/:id", async (request, reply) => {
        const id = identifier.safeParse(
          (request.params as { id?: unknown }).id,
        );
        const fields = actualTransactionFields.safeParse(request.body);
        if (!id.success || !fields.success) {
          return reply.code(400).send({ error: "invalid request" });
        }
        await serial.run("transactions-update", () =>
          actual.updateTransaction(id.data, fields.data),
        );
        return { ok: true };
      });

      api.delete("/transactions/:id", async (request, reply) => {
        const id = identifier.safeParse(
          (request.params as { id?: unknown }).id,
        );
        if (!id.success)
          return reply.code(400).send({ error: "invalid request" });
        await serial.run("transactions-delete", () =>
          actual.deleteTransaction(id.data),
        );
        return { ok: true };
      });

      api.post("/sync", async () => {
        await serial.run("sync", () => actual.sync());
        return { ok: true };
      });
    },
    { prefix: "/v1" },
  );

  server.setErrorHandler((error, _request, reply) => {
    logger.error(
      { errorType: error instanceof Error ? error.name : "UnknownError" },
      "Actual bridge operation failed",
    );
    return reply.code(500).send({ error: "Actual operation failed" });
  });

  return server;
}

class SerialExecutor {
  private tail = Promise.resolve();
  private queued = 0;

  constructor(private readonly metrics: BridgeMetrics) {}

  run<T>(name: string, operation: () => Promise<T>): Promise<T> {
    this.queued += 1;
    this.metrics.queueDepth.set(this.queued);
    const result = this.tail.then(async () => {
      const stop = this.metrics.duration.startTimer({ operation: name });
      try {
        const value = await operation();
        this.metrics.operations.inc({ operation: name, outcome: "success" });
        return value;
      } catch (error) {
        this.metrics.operations.inc({ operation: name, outcome: "failure" });
        throw error;
      } finally {
        stop();
        this.queued -= 1;
        this.metrics.queueDepth.set(this.queued);
      }
    });
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

class BridgeMetrics {
  readonly registry = new Registry();
  readonly operations = new Counter({
    help: "Actual bridge operations by safe operation name and outcome.",
    labelNames: ["operation", "outcome"],
    name: "actual_up_bridge_operations_total",
    registers: [this.registry],
  });
  readonly queueDepth = new Gauge({
    help: "Actual bridge operations running or waiting.",
    name: "actual_up_bridge_queue_depth",
    registers: [this.registry],
  });
  readonly duration = new Histogram({
    help: "Actual bridge operation duration in seconds.",
    labelNames: ["operation"],
    name: "actual_up_bridge_operation_duration_seconds",
    registers: [this.registry],
  });
}

function tokensMatch(provided: string, expected: string): boolean {
  const providedHash = createHash("sha256").update(provided).digest();
  const expectedHash = createHash("sha256").update(expected).digest();
  return timingSafeEqual(providedHash, expectedHash);
}
