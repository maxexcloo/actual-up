import type { AppConfig } from "./config.js";
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

export function dashboard(config: AppConfig, runner: JobRunner): string {
  return /* HTML */ `<!doctype html>
    <html lang="en-AU">
      <head>
        <meta charset="utf-8" />
        <meta name="color-scheme" content="light dark" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <meta
          name="htmx-config"
          content='{"allowEval":false,"allowScriptTags":false,"includeIndicatorStyles":false,"historyCacheSize":0,"responseHandling":[{"code":"204","swap":false},{"code":"[23]..","swap":true},{"code":"[45]..","swap":true,"error":true}]}'
        />
        <title>Actual Up</title>
        <link rel="stylesheet" href="/assets/style.css" />
        <script src="/assets/htmx.js" defer></script>
      </head>
      <body class="min-h-screen bg-base-200/50" hx-history="false">
        <main class="mx-auto max-w-6xl px-4 sm:px-6">
          <header
            class="flex h-18 items-center justify-between border-b border-base-300"
          >
            <a
              class="flex items-center gap-2 text-lg font-semibold tracking-tight"
              href="/"
              ><span
                class="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-content"
                aria-hidden="true"
                >↗</span
              >Actual Up</a
            >
            <a class="btn btn-ghost btn-sm" href="/settings"
              >Accounts &amp; Connections</a
            >
          </header>
          <div class="flex flex-wrap items-end justify-between gap-3 py-7">
            <div>
              <h1 class="text-2xl font-semibold tracking-tight">Bank Sync</h1>
              <p class="mt-1 text-sm ${muted}">
                Up accounts, connected to Actual Budget.
              </p>
            </div>
            <span
              class="badge badge-outline badge-sm ${config.schedule.enabled ? "badge-success" : "badge-warning"}"
              >${config.schedule.enabled ? "Automatic Sync On" : "Automatic Sync Off"}</span
            >
          </div>
          ${status(runner, config.schedule.timezone)}
          <section class="${panel} my-5" aria-labelledby="accounts-heading">
            <div class="card-body gap-4 p-5 sm:p-6">
              <div class="flex items-center justify-between gap-3">
                <h2 id="accounts-heading" class="text-base font-semibold">
                  Connected Accounts
                </h2>
                <span class="badge badge-ghost badge-sm"
                  >${config.mappings.length} Mapped</span
                >
              </div>
              ${config.mappings.length ? `<div class="overflow-x-auto"><table class="table table-sm"><thead><tr><th>Account</th><th>Up Account</th><th>Actual Account</th><th>API Keys</th></tr></thead><tbody>${config.mappings.map((mapping) => `<tr><th class="font-medium">${escapeHtml(mapping.alias)}</th><td><code class="text-xs">${escapeHtml(mapping.upAccountId)}</code></td><td><code class="text-xs">${escapeHtml(mapping.actualAccountId)}</code></td><td><div class="flex flex-wrap gap-1">${mapping.connections.map((id) => `<span class="badge badge-ghost badge-sm">${escapeHtml(id)}</span>`).join("")}</div>${mapping.connections.length > 1 ? `<span class="mt-1 block text-xs ${muted}">Shared Access · One Import</span>` : ""}</td></tr>`).join("")}</tbody></table></div>` : `<p class="text-sm ${muted}">Open Accounts &amp; Connections to connect your accounts. New mappings are backfilled automatically.</p>`}
            </div>
          </section>
          <div class="grid gap-5 md:grid-cols-2">
            <section class="${panel}">
              <div class="card-body gap-4 p-5 sm:p-6">
                <h2 class="text-base font-semibold">Sync Controls</h2>
                <form
                  class="space-y-4"
                  method="post"
                  action="/actions/sync"
                  hx-post="/actions/sync"
                  hx-target="#feedback"
                  hx-disabled-elt="find button"
                >
                  <div>
                    <label
                      class="mb-1.5 block text-xs font-medium"
                      for="account"
                      >Account</label
                    ><select class="select w-full" id="account" name="account">
                      <option value="">All Mapped Accounts</option>
                      ${config.mappings.map((mapping) => `<option value="${escapeHtml(mapping.alias)}">${escapeHtml(mapping.alias)}</option>`).join("")}
                    </select>
                  </div>
                  <div>
                    <label class="mb-1.5 block text-xs font-medium" for="since"
                      >Backfill From
                      <span class="${muted}">(Optional)</span></label
                    ><input
                      class="input w-full"
                      type="date"
                      id="since"
                      name="since"
                    />
                    <p class="mt-2 text-xs ${muted}">
                      Leave blank for the ${config.schedule.lookbackDays}-day
                      lookback.
                      ${config.schedule.enabled ? "Full history is checked automatically." : "Automatic backfill is paused."}
                    </p>
                  </div>
                  <div class="flex flex-wrap gap-2">
                    <button class="btn btn-sm" name="mode" value="dry-run">
                      Preview Changes</button
                    ><button
                      class="btn btn-primary btn-sm"
                      type="button"
                      name="mode"
                      value="live"
                      hx-post="/actions/sync"
                      hx-include="closest form"
                      hx-target="#feedback"
                      hx-disabled-elt="this"
                      hx-confirm="Import these transactions into Actual?"
                    >
                      Sync Now
                    </button>
                  </div>
                </form>
                <div class="flex flex-wrap gap-2 border-t border-base-200 pt-4">
                  <form
                    method="post"
                    action="/actions/validate"
                    hx-post="/actions/validate"
                    hx-target="#feedback"
                    hx-disabled-elt="find button"
                  >
                    <button class="btn btn-ghost btn-sm">
                      Check Connections
                    </button>
                  </form>
                  <form
                    method="post"
                    action="/actions/discover"
                    hx-post="/actions/discover"
                    hx-target="#feedback"
                    hx-disabled-elt="find button"
                  >
                    <button class="btn btn-ghost btn-sm">
                      Discover Accounts
                    </button>
                  </form>
                </div>
                <p
                  class="text-xs ${muted}"
                  id="feedback"
                  role="status"
                  aria-live="polite"
                >
                  ${config.schedule.enabled ? "Manual actions are optional. Automatic sync runs in the background." : "Automatic sync is paused. Use the controls above to sync manually."}
                </p>
              </div>
            </section>
            <section class="${panel}">
              <div class="card-body gap-4 p-5 sm:p-6">
                <h2 class="text-base font-semibold">Automation</h2>
                <dl class="divide-y divide-base-200 text-sm">
                  ${setting("Recent Sync", config.schedule.cron === "*/15 * * * *" ? "Every 15 minutes" : config.schedule.cron)}
                  ${setting("Full Backfill", config.schedule.backfillCron === "0 3 * * *" ? "On startup + nightly at 03:00" : `On startup + ${config.schedule.backfillCron}`)}
                  ${setting("Timezone", config.schedule.timezone)}
                  ${setting("Recent Lookback", `${config.schedule.lookbackDays} days`)}
                  ${setting("API Keys", config.up.connections.map(({ id }) => id).join(", "))}
                </dl>
                <p class="text-xs leading-relaxed ${muted}">
                  Manage accounts and connections in the browser. API keys are
                  encrypted on the server.
                </p>
              </div>
            </section>
          </div>
          <footer class="flex justify-between gap-4 py-6 text-xs ${muted}">
            <span>Up → Actual Budget</span>
            <form method="post" action="/logout">
              <button class="link link-hover">Sign Out</button>
            </form>
          </footer>
        </main>
      </body>
    </html>`;
}

function setting(label: string, value: string): string {
  return `<div class="flex justify-between gap-4 py-3"><dt class="${muted}">${escapeHtml(label)}</dt><dd class="text-right wrap-anywhere">${escapeHtml(value)}</dd></div>`;
}

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
