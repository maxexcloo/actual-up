import pino, { type Logger } from "pino";

import { ActualBudgetClient } from "./actual-client.js";
import { LoggingAlertSink, WebhookAlertSink, type AlertSink } from "./alerts.js";
import { environmentValue, type AppConfig } from "./config.js";
import { ConfigError } from "./errors.js";
import { Metrics } from "./metrics.js";
import { SyncEngine } from "./sync-engine.js";
import type { ActualClient, UpClientLike } from "./types.js";
import { connectionToken } from "./settings-store.js";
import { UpClient } from "./up-client.js";

export type Runtime = {
  actual: ActualClient;
  alerts: AlertSink;
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
  if (config.alerts) {
    // URL errors would echo the alert URL, which may embed a token.
    if (
      !["http:", "https:"].includes(
        URL.parse(environmentValue(config.alerts.urlEnv))?.protocol ?? "",
      )
    ) {
      throw new ConfigError("Alert webhook URL must use HTTP or HTTPS");
    }
  }
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
  const alerts = config.alerts
    ? new WebhookAlertSink(config.alerts, logger)
    : new LoggingAlertSink(logger);
  const engine = new SyncEngine(config, actual, clients, alerts, metrics, logger);
  return { actual, alerts, clients, engine, logger, metrics };
}

export { assertActualCompatibility } from "./actual-client.js";
