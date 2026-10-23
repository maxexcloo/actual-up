import pino, { type Logger } from "pino";

import { ActualBudgetClient } from "./actual-client.js";
import type { AppConfig } from "./config.js";
import { Metrics } from "./metrics.js";
import { SyncEngine } from "./sync-engine.js";
import type { ActualClient, UpClientLike } from "./types.js";
import { connectionToken } from "./settings-store.js";
import { UpClient } from "./up-client.js";

export type Runtime = {
  actual: ActualClient;
  clients: Map<string, UpClientLike>;
  engine: SyncEngine;
  logger: Logger;
  metrics: Metrics;
};

export function createLogger(): Logger {
  return pino({
    level: process.env.LOG_LEVEL ?? "info",
    redact: {
      remove: true,
      paths: ["req.headers.authorization", "token", "password", "sessionToken", "secret"],
    },
  });
}

export async function createRuntime(config: AppConfig): Promise<Runtime> {
  const logger = createLogger();
  const metrics = new Metrics();
  const clients = new Map<string, UpClientLike>(
    config.up.connections.map((connection) => [
      connection.id,
      new UpClient(
        connectionToken(config, connection),
        logger.child({ connection: connection.id }),
      ),
    ]),
  );
  const actual = new ActualBudgetClient(config);
  const engine = new SyncEngine(config, actual, clients, metrics, logger);
  return { actual, clients, engine, logger, metrics };
}
