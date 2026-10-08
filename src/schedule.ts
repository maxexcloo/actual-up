import { Cron } from "croner";

import type { AppConfig } from "./config.js";
import type { JobRunner } from "./job-runner.js";
import type { SyncEngine } from "./sync-engine.js";
import type { ActualClient } from "./types.js";

/** Full history repairs interrupted imports without a separate cursor database. */
export function startSchedule(
  config: AppConfig,
  engine: SyncEngine,
  runner: JobRunner,
  actual: Pick<ActualClient, "sync">,
): () => void {
  if (!config.schedule.enabled) return () => {};
  const reconcile = (backfill: boolean) => {
    runner.enqueue(
      backfill ? "automatic-backfill" : "schedule",
      backfill ? "automatic-backfill" : "schedule",
      async () => {
        await actual.sync();
        return engine.reconcile(backfill ? { since: "1970-01-01" } : {});
      },
    );
  };
  const options = { paused: true, timezone: config.schedule.timezone };
  const recent = new Cron(config.schedule.cron, options, () =>
    reconcile(false),
  );
  const backfill = new Cron(config.schedule.backfillCron, options, () =>
    reconcile(true),
  );
  reconcile(true);
  recent.resume();
  backfill.resume();
  return () => {
    recent.stop();
    backfill.stop();
  };
}
