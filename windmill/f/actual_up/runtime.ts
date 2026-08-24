import * as wmill from "windmill-client@1.792.0";

import { ActualBridgeClient } from "./actual_client";
import { loadConfig } from "./config";
import { SyncEngine } from "./sync_engine";
import type { SyncReport } from "./types";
import { UpClient } from "./up_client";

export async function createRuntime() {
  const config = await loadConfig();
  const actual = new ActualBridgeClient(
    config.actual.bridgeUrl,
    config.actual.bridgeToken,
  );
  const clients = new Map(
    config.up.connections.map((connection) => [
      connection.id,
      new UpClient(connection.token, connection.id),
    ]),
  );
  return {
    actual,
    clients,
    config,
    engine: new SyncEngine(config, actual, clients),
  };
}

export async function recordRun(trigger: string, report: SyncReport) {
  await wmill.setState("f/actual_up/status", {
    finishedAt: new Date().toISOString(),
    jobId: process.env.WM_JOB_ID ?? null,
    report,
    trigger,
  });
}
