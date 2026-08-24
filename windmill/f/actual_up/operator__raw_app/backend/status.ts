//native
import * as wmill from "windmill-client";

type SafeConfig = {
  actual?: { bridgeUrl?: string };
  mappings?: unknown[];
  schedule?: { lookbackDays?: number; timezone?: string };
  up?: { connections?: Array<{ id?: string; webhook?: unknown }> };
};

export async function main() {
  const config = (await wmill.getResource("f/actual_up/config")) as SafeConfig;
  const state = (await wmill.getState("f/actual_up/status")) ?? {
    finishedAt: null,
    jobId: null,
    report: null,
    trigger: null,
  };
  return {
    config: {
      actualBridgeUrl: config.actual?.bridgeUrl ?? null,
      connectionCount: config.up?.connections?.length ?? 0,
      connections: (config.up?.connections ?? []).map((connection) => ({
        hasWebhook: Boolean(connection.webhook),
        id: connection.id,
      })),
      lookbackDays: config.schedule?.lookbackDays ?? 30,
      mappingCount: config.mappings?.length ?? 0,
      timezone: config.schedule?.timezone ?? "Australia/Sydney",
    },
    state,
  };
}
