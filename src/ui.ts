import type { Job, JobRunner } from "./job-runner.js";

export function escapeHtml(value: unknown): string {
  return String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
}

const panel = "card border border-base-300 bg-base-100";
const muted = "text-base-content/55";

export function statusVersion(runner: JobRunner): string {
  const latest = runner.history[0];
  return `${latest?.id ?? "none"}:${latest?.state ?? "idle"}:${runner.depth}`;
}

export function status(
  runner: JobRunner,
  timezone = "Australia/Sydney",
): string {
  const latest = runner.history[0];
  const heading = runner.depth
    ? "Sync in Progress"
    : latest?.state === "failure"
      ? "A Run Needs Attention"
      : latest
        ? "Ready for the Next Sync"
        : "Ready to Connect";
  return `<section id="runs" hx-get="/runs?version=${encodeURIComponent(statusVersion(runner))}" hx-trigger="refresh-status from:body, every 3s" hx-swap="outerHTML" aria-label="Run Status" class="${panel}"><div class="card-body gap-4 p-5 sm:p-6"><div class="flex items-center justify-between gap-3"><div><h2 class="text-base font-semibold">${heading}</h2><p class="mt-1 text-xs ${muted}">${latest ? `${escapeHtml(triggerLabel(latest.trigger))} · ${escapeHtml(runTime(latest, timezone))}` : "Your first sync will appear here."}</p></div>${badge(latest?.state ?? "idle")}</div>${latest?.state === "failure" ? '<div class="alert alert-soft alert-error text-sm" role="status">Check credentials, mappings and connectivity. The next scheduled run will try again.</div>' : ""}${latest?.result !== undefined ? renderResult(latest.result) : ""}${
    runner.history.length > 1
      ? `<details class="border-t border-base-200 pt-3"><summary class="cursor-pointer text-xs ${muted}">Recent Activity · ${runner.history.length} Runs</summary><div class="mt-3 space-y-3">${runner.history
          .slice(1)
          .map(
            (job) =>
              `<details class="rounded-lg border border-base-200 p-3"><summary class="flex cursor-pointer items-center justify-between gap-3 text-sm"><span>${escapeHtml(triggerLabel(job.trigger))} <time class="ml-2 text-xs ${muted}">${escapeHtml(runTime(job, timezone))}</time></span>${badge(job.state)}</summary>${job.result !== undefined ? `<div class="mt-3">${renderResult(job.result)}</div>` : ""}</details>`,
          )
          .join(
            "",
          )}</div><p class="mt-3 text-xs ${muted}">Recent activity resets when the app restarts.</p></details>`
      : ""
  }</div></section>`;
}

function badge(state: string): string {
  const colour =
    state === "failure"
      ? "badge-error"
      : state === "success"
        ? "badge-success"
        : "badge-ghost";
  return `<span class="badge badge-soft badge-sm ${colour}">${escapeHtml(state.charAt(0).toUpperCase() + state.slice(1))}</span>`;
}

function triggerLabel(trigger: string): string {
  return (
    (
      {
        "automatic-backfill": "Automatic Backfill",
        schedule: "Scheduled Sync",
        manual: "Manual Sync",
        "dry-run": "Preview",
        backfill: "Backfill",
        validate: "Connection Check",
        discover: "Account Discovery",
        webhook: "Up Webhook",
        settings: "Account Setup",
      } as Record<string, string>
    )[trigger] ?? trigger
  );
}

function runTime(job: Job, timezone: string): string {
  const value = job.finishedAt ?? job.startedAt;
  return value
    ? new Intl.DateTimeFormat("en-AU", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: timezone,
      }).format(new Date(value))
    : "Queued";
}

function renderResult(value: unknown): string {
  const labels = [
    "inspected",
    "imported",
    "updated",
    "deleted",
    "conflicts",
    "failed",
  ] as const;
  if (
    typeof value === "object" &&
    value !== null &&
    labels.every(
      (key) =>
        key in value &&
        typeof (value as Record<string, unknown>)[key] === "number",
    )
  ) {
    return `<div class="grid grid-cols-3 gap-4 rounded-lg bg-base-200/50 p-4 sm:grid-cols-6">${labels.map((key) => `<div><div class="text-xl font-semibold tabular-nums">${escapeHtml((value as Record<string, unknown>)[key])}</div><div class="mt-1 text-xs capitalize ${muted}">${key}</div></div>`).join("")}</div>`;
  }
  if (
    typeof value === "object" &&
    value !== null &&
    "ok" in value &&
    value.ok === true
  )
    return '<p class="text-sm text-success">Operation completed successfully.</p>';
  return `<pre class="max-h-72 overflow-auto rounded-lg bg-base-200/50 p-4 text-xs leading-relaxed">${escapeHtml(JSON.stringify(value, null, 2))}</pre>`;
}
