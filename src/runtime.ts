import pino, { type Logger } from "pino";

import { ActualBudgetClient } from "./actual-client.js";
import type { AppConfig } from "./config.js";
import { JobRunner } from "./job-runner.js";
import { LogBuffer } from "./logs.js";
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
  logs: LogBuffer;
  metrics: Metrics;
  runner: JobRunner;
};

export async function createRuntime(config: AppConfig): Promise<Runtime> {
  const level = process.env.LOG_LEVEL ?? "info";
  const logs = new LogBuffer();
  const logger = pino(
    {
      level,
      redact: {
        remove: true,
        paths: ["req.headers.authorization", "token", "password", "sessionToken", "secret"],
      },
    },
    pino.multistream([
      { level, stream: process.stdout },
      { level, stream: logs },
    ]),
  );
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
  const runner = new JobRunner(metrics, logger);
  return { actual, clients, engine, logger, logs, metrics, runner };
}
