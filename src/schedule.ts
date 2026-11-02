import { Cron } from "croner";

import type { AppConfig } from "./config.js";
import type { JobRunner } from "./job-runner.js";
import { HISTORY_START } from "./schemas.js";
import type { SyncEngine } from "./sync-engine.js";

/** Full history repairs interrupted imports without a separate cursor database. */
export function startSchedule(
  config: AppConfig,
  engine: SyncEngine,
  runner: JobRunner,
): () => void {
  if (!config.schedule.enabled) return () => {};
  const reconcile = (backfill: boolean) => {
    if (!config.mappings.length) return;
    const trigger = backfill ? "automatic-backfill" : "schedule";
    const since = backfill ? { since: HISTORY_START } : {};
    runner.enqueue(trigger, trigger, (progress) => engine.reconcile({ ...since, progress }), {
      mode: "live",
      ...since,
    });
  };
  const options = { paused: true, timezone: config.schedule.timezone };
  const recent = new Cron(config.schedule.cron, options, () => reconcile(false));
  const backfill = new Cron(config.schedule.backfillCron, options, () => reconcile(true));
  reconcile(true);
  recent.resume();
  backfill.resume();
  return () => {
    recent.stop();
    backfill.stop();
  };
}
