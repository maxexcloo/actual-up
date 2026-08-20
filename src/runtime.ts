import { createRequire } from "node:module";

import pino, { type Logger } from "pino";

import { ActualBudgetClient } from "./actual-client.js";
import {
  LoggingAlertSink,
  WebhookAlertSink,
  type AlertSink,
} from "./alerts.js";
import { environmentValue, type AppConfig } from "./config.js";
import { Metrics } from "./metrics.js";
import { SyncEngine } from "./sync-engine.js";
import type { ActualClient, UpClientLike } from "./types.js";
import { UpClient } from "./up-client.js";

const require = createRequire(import.meta.url);
const packageManifest = require("../package.json") as {
  dependencies: Record<string, string>;
};

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
      paths: [
        "req.headers.authorization",
        "req.headers.x-up-authenticity-signature",
        "token",
        "password",
        "sessionToken",
        "secret",
      ],
      remove: true,
    },
  });
}

export async function createRuntime(config: AppConfig): Promise<Runtime> {
  const logger = createLogger();
  const metrics = new Metrics();
  for (const connection of config.up.connections) {
    if (connection.webhook) environmentValue(connection.webhook.secretEnv);
  }
  if (config.alerts) {
    const alertUrl = new URL(environmentValue(config.alerts.urlEnv));
    if (!["http:", "https:"].includes(alertUrl.protocol)) {
      throw new Error("Alert webhook URL must use HTTP or HTTPS");
    }
  }
  const clients = new Map<string, UpClientLike>(
    config.up.connections.map((connection) => [
      connection.id,
      new UpClient(
        environmentValue(connection.tokenEnv),
        logger.child({ connection: connection.id }),
      ),
    ]),
  );
  const actual = new ActualBudgetClient(config.actual);
  await actual.open();
  const alerts = config.alerts
    ? new WebhookAlertSink(config.alerts, logger)
    : new LoggingAlertSink(logger);
  const engine = new SyncEngine(
    config,
    actual,
    clients,
    alerts,
    metrics,
    logger,
  );
  return { actual, alerts, clients, engine, logger, metrics };
}

export function assertActualCompatibility(serverVersion: string): void {
  const apiVersion = packageManifest.dependencies["@actual-app/api"];
  if (!apiVersion)
    throw new Error("@actual-app/api is missing from dependencies");
  const expected = apiVersion.split(".").slice(0, 2).join(".");
  const actual = serverVersion.split(".").slice(0, 2).join(".");
  if (expected !== actual) {
    throw new Error(
      `Actual server ${serverVersion} is incompatible with API ${apiVersion}; align the versions`,
    );
  }
}
