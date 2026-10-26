import type { AccountIssue, Job, JobState, SyncCounts, SyncReport } from "../../src/api.js";

export const syncTriggers = new Set([
  "automatic-backfill",
  "backfill",
  "dry-run",
  "manual",
  "schedule",
]);

const states: Record<string, string> = {
  failure: "Failed",
  idle: "Idle",
  queued: "Queued",
  running: "Running",
  success: "Completed",
  warning: "Needs Attention",
};
export const stateLabel = (state: string) => states[state] ?? state;

export const stateColour = (state: JobState | "idle") =>
  state === "failure"
    ? "red"
    : state === "warning"
      ? "amber"
      : state === "success"
        ? "green"
        : "gray";

const triggers: Record<string, string> = {
  "automatic-backfill": "Automatic Backfill",
  backfill: "Backfill",
  discover: "Account Discovery",
  "dry-run": "Preview",
  manual: "Manual Sync",
  schedule: "Scheduled Sync",
  settings: "Account Setup",
  "test-connection": "Connection Test",
  validate: "Connection Check",
};
export const triggerLabel = (trigger: string) => triggers[trigger] ?? trigger;

/** Connection IDs are lowercase slugs; show them as names. */
export const connectionName = (id: string) =>
  id
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

export const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

export function formatTime(value: string | undefined, timezone: string): string {
  if (!value) return "Queued";
  return new Intl.DateTimeFormat("en-AU", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone,
  }).format(new Date(value));
}

export function elapsed(startedAt: string, now: number): string {
  const seconds = Math.max(0, Math.floor((now - Date.parse(startedAt)) / 1000));
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export const scheduleLabel = (cron: string) =>
  cron === "*/15 * * * *" ? "Every 15 Minutes" : cron === "0 3 * * *" ? "Nightly at 03:00" : cron;

/** Summarise the queue the way the status panel presents it. */
export function summarise(jobs: readonly Job[]) {
  const syncs = jobs.filter((job) => syncTriggers.has(job.trigger));
  const active = jobs.find((job) => job.state === "running");
  const latest = syncs[0];
  const lastSuccess = syncs.find(
    (job) =>
      job.state === "success" &&
      job.trigger !== "dry-run" &&
      !(
        typeof job.result === "object" &&
        job.result !== null &&
        "publication" in job.result &&
        job.result.publication === "not-required"
      ),
  );
  const heading = active
    ? triggerLabel(active.trigger)
    : latest?.state === "failure" || latest?.state === "warning"
      ? "Sync Needs Attention"
      : latest
        ? "Sync Status"
        : "Ready for Your First Sync";
  return {
    active,
    heading,
    lastSuccess,
    latest,
    queued: jobs.filter((job) => job.state === "queued").length,
    recent: jobs.filter((job) => job !== latest),
    state: active?.state ?? latest?.state ?? ("idle" as const),
  };
}

export const reportFields = [
  "inspected",
  "imported",
  "updated",
  "unchanged",
  "deleted",
  "conflicts",
  "failed",
] as const satisfies ReadonlyArray<keyof SyncCounts>;

export const isReport = (value: unknown): value is SyncReport =>
  typeof value === "object" && value !== null && "inspected" in value;

export const accountIssues: Record<AccountIssue, string> = {
  "up-unavailable": "Could not read Up. Test this account’s Up connections and retry.",
  "actual-unavailable": "Could not read Actual. Test the Actual connection and check the mapping.",
  "actual-write-failed": "Could not apply changes in Actual. Check the account mapping and retry.",
};
