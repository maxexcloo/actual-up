import { Cron } from "croner";
import type { AppConfig } from "./config.js";
import type { Job, JobRunner } from "./job-runner.js";
import { HISTORY_START } from "./sync-engine.js";

export function escapeHtml(value: unknown): string {
  return String(value).replace(
    /[&<>"']/g,
    (char) => ({ "'": "&#39;", '"': "&quot;", "&": "&amp;", "<": "&lt;", ">": "&gt;" })[char]!,
  );
}

export const themeControl = `<button type="button" class="wa-plain theme-toggle" data-theme-toggle aria-label="Dark Mode" aria-pressed="false" title="Switch to Dark Mode">Dark Mode</button>`;
export const pageHead = `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="htmx-config" content='{"allowEval":false,"allowScriptTags":false,"includeIndicatorStyles":false,"historyCacheSize":0,"responseHandling":[{"code":"204","swap":false},{"code":"[23]..","swap":true},{"code":"[45]..","swap":true,"error":true}]}'><link rel="stylesheet" href="/assets/style.css"><script src="/assets/components.js" type="module"></script><script src="/assets/theme.js" defer></script>`;

export function statusVersion(runner: JobRunner): string {
  return JSON.stringify(
    runner.history.map(({ id, state, progress, startedAt }) => [
      id,
      state,
      progress,
      state === "running" && startedAt
        ? Math.floor((Date.now() - Date.parse(startedAt)) / 1000)
        : null,
    ]),
  );
}

const syncTriggers = new Set(["automatic-backfill", "backfill", "dry-run", "manual", "schedule"]);
export function status(
  runner: JobRunner,
  timezone = "Australia/Sydney",
  schedule?: AppConfig["schedule"],
): string {
  const syncs = runner.history.filter((job) => syncTriggers.has(job.trigger));
  const active = runner.history.find((job) => job.state === "running");
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
  const queued = runner.history.filter((job) => job.state === "queued").length;
  const heading = active
    ? triggerLabel(active.trigger)
    : latest?.state === "failure" || latest?.state === "warning"
      ? "Sync Needs Attention"
      : latest
        ? "Sync Status"
        : "Ready for Your First Sync";
  const next = schedule?.enabled ? nextRun(schedule.cron, timezone) : undefined;
  return `<section id="runs" class="wa-stack" hx-get="/runs?version=${encodeURIComponent(statusVersion(runner))}" hx-trigger="refresh-status from:body, every 3s" hx-swap="outerHTML" aria-label="Sync Status"><wa-card><div class="wa-stack">
    <div class="wa-split"><h2>${heading}</h2>${badge(active?.state ?? latest?.state ?? "idle")}</div>
    <div role="status" aria-live="polite">${active ? `<p>${escapeHtml(active.progress?.stage ?? "Starting")} ${active.progress?.account ? `· ${escapeHtml(active.progress.account)}` : ""} · Started ${runTime(active, timezone)} · <span role="timer" aria-live="off">${elapsed(active)} elapsed</span>${active.progress?.total !== undefined ? ` · ${active.progress.completed ?? 0} of ${active.progress.total} accounts processed` : ""}</p>` : ""}${queued ? `<p>${queued} queued operation${queued === 1 ? "" : "s"}.</p>` : ""}</div>
    <p class="hint">Last Successful Sync: ${lastSuccess ? runTime(lastSuccess, timezone) : "None in recent activity"}${schedule ? ` · Automatic Sync ${schedule.enabled ? "On" : "Off"}${next ? ` · Next Recent Sync: ${formatTime(next, timezone)}` : ""}` : ""}</p>
    ${latest ? renderJob(latest, timezone) : "<p>Your first sync result will appear here.</p>"}
    ${
      runner.history.length
        ? `<details id="activity"><summary>Recent Activity · ${runner.history.length} Runs</summary><div class="wa-stack">${runner.history
            .filter((job) => job !== latest)
            .map(
              (job) =>
                `<details id="run-${escapeHtml(job.id)}"><summary>${escapeHtml(triggerLabel(job.trigger))} · ${runTime(job, timezone)} · ${escapeHtml(stateLabel(job.state))}</summary>${renderJob(job, timezone)}</details>`,
            )
            .join(
              "",
            )}</div><p class="hint">Activity and last-success times reset when the app restarts.</p></details>`
        : ""
    }
  </div></wa-card></section>`;
}
function nextRun(pattern: string, timezone: string): Date | undefined {
  const cron = new Cron(pattern, { paused: true, timezone });
  const next = cron.nextRun();
  cron.stop();
  return next ?? undefined;
}
function stateLabel(state: string): string {
  return (
    (
      {
        failure: "Failed",
        idle: "Idle",
        queued: "Queued",
        running: "Running",
        success: "Completed",
        warning: "Needs Attention",
      } as Record<string, string>
    )[state] ?? state
  );
}
function badge(state: string): string {
  const colour =
    state === "failure"
      ? "danger"
      : state === "warning"
        ? "warning"
        : state === "success"
          ? "success"
          : "neutral";
  return `<wa-badge variant="${colour}">${escapeHtml(stateLabel(state))}</wa-badge>`;
}
function triggerLabel(trigger: string): string {
  return (
    (
      {
        "automatic-backfill": "Automatic Backfill",
        backfill: "Backfill",
        discover: "Account Discovery",
        "dry-run": "Preview",
        manual: "Manual Sync",
        schedule: "Scheduled Sync",
        settings: "Account Setup",
        "test-connection": "Connection Test",
        validate: "Connection Check",
      } as Record<string, string>
    )[trigger] ?? trigger
  );
}
function elapsed(job: Job): string {
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(job.startedAt!)) / 1000));
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
function formatTime(value: Date, timezone: string): string {
  return escapeHtml(
    new Intl.DateTimeFormat("en-AU", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: timezone,
    }).format(value),
  );
}
function runTime(job: Job, timezone: string): string {
  const value = job.finishedAt ?? job.startedAt;
  return value ? formatTime(new Date(value), timezone) : "Queued";
}
function retry(job: Job): string {
  if (!syncTriggers.has(job.trigger) || !["failure", "warning"].includes(job.state)) return "";
  const scope = job.scope ?? {};
  return `<form method="post" action="/actions/sync" hx-post="/actions/sync" hx-target="#feedback" hx-disabled-elt="find button">${Object.entries(
    {
      mode: scope.mode ?? "live",
      account: scope.account ?? "",
      connection: scope.connection ?? "",
      since: scope.since ?? (job.trigger === "automatic-backfill" ? HISTORY_START : ""),
    },
  )
    .map(([key, value]) => `<input type="hidden" name="${key}" value="${escapeHtml(value)}">`)
    .join("")}<button>Retry ${scope.account ? escapeHtml(scope.account) : "Sync"}</button></form>`;
}
function renderJob(job: Job, timezone: string): string {
  return `<div class="wa-stack"><p>${escapeHtml(triggerLabel(job.trigger))} · ${escapeHtml(job.scope?.account || job.scope?.connection || (syncTriggers.has(job.trigger) ? "All Accounts" : "Connections"))} · ${runTime(job, timezone)}${job.scope?.since ? ` · From ${escapeHtml(job.scope.since)}` : ""}</p>${job.state === "failure" && job.result === undefined ? '<p role="alert">The operation could not complete. Test the saved connections, check the account mapping and retry. No completed result was received.</p>' : ""}${job.result !== undefined ? renderResult(job.result) : ""}${retry(job)}</div>`;
}
function renderResult(value: unknown): string {
  const labels = [
    "inspected",
    "imported",
    "updated",
    "unchanged",
    "deleted",
    "conflicts",
    "failed",
  ];
  if (typeof value === "object" && value !== null && "inspected" in value) {
    const result = value as Record<string, unknown>;
    const preview = result.preview === true;
    const proposed: Record<string, string> = {
      imported: "Would Import",
      updated: "Would Update",
      deleted: "Would Delete",
    };
    const issues: Record<string, string> = {
      "up-unavailable": "Could not read Up. Test this account’s Up connections and retry.",
      "actual-unavailable":
        "Could not read Actual. Test the Actual connection and check the mapping.",
      "actual-write-failed":
        "Could not apply changes in Actual. Check the account mapping and retry.",
    };
    return `${preview ? "<p>Preview only. No import changes were applied. Estimates compare bank-owned fields and category mappings; Actual matching and rules run during a live sync.</p>" : ""}<dl class="results wa-grid wa-gap-s">${labels
      .filter((key) => typeof result[key] === "number")
      .map(
        (key) =>
          `<div><dt>${preview && proposed[key] ? proposed[key] : key.charAt(0).toUpperCase() + key.slice(1)}</dt><dd>${escapeHtml(result[key])}</dd></div>`,
      )
      .join(
        "",
      )}</dl>${result.publication === "published" ? "<p>Changes published to Actual.</p>" : result.publication === "failed" ? '<p role="alert">Publishing to Actual failed. Some changes may be saved locally; retry the sync to publish them.</p>' : ""}${Number(result.conflicts) > 0 ? '<p role="status">Protected Actual edits were retained. Review the affected accounts in Actual; retrying will preserve those edits again.</p>' : ""}${Array.isArray(result.accounts) ? `<ul>${result.accounts.map((entry) => `<li>${escapeHtml(entry.account)}: ${entry.failed ? escapeHtml(issues[entry.issue] ?? "Sync failed; test connections and retry.") : `${entry.imported} ${preview ? "would import" : "imported"}, ${entry.updated} ${preview ? "would update" : "updated"}, ${entry.unchanged} unchanged, ${entry.deleted} ${preview ? "would delete" : "deleted"}`}${entry.conflicts ? ` · ${entry.conflicts} protected deletion conflicts` : ""}</li>`).join("")}</ul>` : ""}`;
  }
  if (typeof value === "object" && value !== null && "ok" in value && value.ok === true)
    return "<p>Operation completed successfully.</p>";
  return `<pre>${escapeHtml(JSON.stringify(value, null, 2))}</pre>`;
}

export function connectionTestStatus(target: string, state?: Job["state"] | "busy"): string {
  const pending = state === "queued" || state === "running";
  const message =
    state === "success"
      ? "Connection Working"
      : state === "failure"
        ? "Connection Failed"
        : state === "busy"
          ? "Queue Busy — Try Again Shortly"
          : pending
            ? "Testing Connection…"
            : "";
  return `<span id="test-${escapeHtml(target)}" class="hint" role="status" aria-live="polite"${pending ? ` hx-get="/connection-tests/${encodeURIComponent(target)}" hx-trigger="every 1s" hx-swap="outerHTML"` : ""}>${message}</span>`;
}
