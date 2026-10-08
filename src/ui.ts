import type { AppConfig } from "./config.js";
import type { JobRunner } from "./job-runner.js";

export function escapeHtml(value: unknown): string {
  return String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
}

export function dashboard(config: AppConfig, runner: JobRunner): string {
  return /* HTML */ `<!doctype html>
    <html lang="en-AU">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <meta
          name="htmx-config"
          content='{"allowEval":false,"allowScriptTags":false,"includeIndicatorStyles":false,"historyCacheSize":0,"responseHandling":[{"code":"204","swap":false},{"code":"[23]..","swap":true},{"code":"[45]..","swap":true,"error":true}]}'
        />
        <title>Actual Up</title>
        <link rel="stylesheet" href="/assets/style.css" />
        <script src="/assets/htmx.js" defer></script>
      </head>
      <body hx-history="false">
        <main>
          <header>
            <a class="brand" href="/"
              >actual<span>up</span><span class="brand-mark">↗</span></a
            ><span class="private">Private workspace</span>
          </header>
          <section class="intro">
            <p class="eyebrow">UP BANK → ACTUAL BUDGET</p>
            <h1>Your money.<br />In the right place.</h1>
            <p class="lede">
              A quiet home for your bank sync. Preview changes, check
              connections and keep Actual up to date.
            </p>
          </section>
          ${status(runner)}
          <div class="columns">
            <section class="card">
              <p class="eyebrow">TAKE ACTION</p>
              <h2>Make the next move</h2>
              <form
                method="post"
                action="/actions/sync"
                hx-post="/actions/sync"
                hx-target="#feedback"
                hx-disabled-elt="find button"
              >
                <label for="account">Account</label
                ><select id="account" name="account">
                  <option value="">All mapped accounts</option>
                  ${config.mappings.map((m) => `<option value="${escapeHtml(m.alias)}">${escapeHtml(m.alias)}</option>`).join("")}</select
                ><label for="since"
                  >Backfill from <span class="muted">(optional)</span></label
                ><input type="date" id="since" name="since" />
                <p class="hint">
                  Leave blank to use the ${config.schedule.lookbackDays}-day
                  lookback. A dry run previews changes without importing them.
                </p>
                <div class="buttons">
                  <button name="mode" value="dry-run">Preview changes</button
                  ><button
                    class="primary"
                    type="button"
                    name="mode"
                    value="live"
                    hx-post="/actions/sync"
                    hx-include="closest form"
                    hx-target="#feedback"
                    hx-disabled-elt="this"
                    hx-confirm="Import these transactions into Actual?"
                  >
                    Sync now ↗
                  </button>
                </div>
              </form>
              <div class="utilities">
                <form
                  method="post"
                  action="/actions/validate"
                  hx-post="/actions/validate"
                  hx-target="#feedback"
                  hx-disabled-elt="find button"
                >
                  <button>Check connections</button>
                </form>
                <form
                  method="post"
                  action="/actions/discover"
                  hx-post="/actions/discover"
                  hx-target="#feedback"
                  hx-disabled-elt="find button"
                >
                  <button>Discover accounts</button>
                </form>
              </div>
              <p id="feedback" role="status" aria-live="polite">
                Ready when you are.
              </p>
            </section>
            <section class="card">
              <p class="eyebrow">ON YOUR SCHEDULE</p>
              <h2>
                ${config.schedule.enabled ? "Automatic sync is on" : "Automatic sync is off"}
              </h2>
              <dl>
                <div>
                  <dt>Schedule</dt>
                  <dd>${escapeHtml(config.schedule.cron)}</dd>
                </div>
                <div>
                  <dt>Timezone</dt>
                  <dd>${escapeHtml(config.schedule.timezone)}</dd>
                </div>
                <div>
                  <dt>Lookback</dt>
                  <dd>${config.schedule.lookbackDays} days</dd>
                </div>
                <div>
                  <dt>Connections</dt>
                  <dd>
                    ${escapeHtml(config.up.connections.map((c) => c.id).join(", "))}
                  </dd>
                </div>
              </dl>
              <p class="hint">
                Configuration is managed in YAML. Credentials stay in 1Password
                and are supplied to the server.
              </p>
            </section>
          </div>
          <section class="card mappings">
            <p class="eyebrow">ACCOUNT MAPPINGS</p>
            <h2>A place for every account</h2>
            ${config.mappings.length ? `<div class="table-scroll"><table><thead><tr><th>Account</th><th>Up account ID</th><th>Actual account ID</th><th>Connections</th></tr></thead><tbody>${config.mappings.map((m) => `<tr><th>${escapeHtml(m.alias)}</th><td><code>${escapeHtml(m.upAccountId)}</code></td><td><code>${escapeHtml(m.actualAccountId)}</code></td><td>${escapeHtml(m.connections.join(", "))}</td></tr>`).join("")}</tbody></table></div>` : `<p class="empty">No accounts mapped yet. Discover accounts, add their IDs to your configuration, then preview the first sync.</p>`}
          </section>
          <footer>
            One queue. One budget. All in sync.<span>Actual Up</span>
          </footer>
        </main>
      </body>
    </html>`;
}

export function statusVersion(runner: JobRunner): string {
  const latest = runner.history[0];
  return `${latest?.id ?? "none"}:${latest?.state ?? "idle"}:${runner.depth}`;
}

export function status(runner: JobRunner): string {
  const latest = runner.history[0];
  return `<section id="runs" hx-get="/runs?version=${encodeURIComponent(statusVersion(runner))}" hx-trigger="refresh-status from:body, every 3s" hx-swap="outerHTML" aria-label="Run status"><div class="summary"><div><p class="eyebrow">SYNC STATUS</p><strong>${runner.depth ? "Working through your queue" : latest ? (latest.state === "failure" ? "A run needs attention" : "Ready for the next sync") : "Let’s get connected"}</strong></div><span class="badge">${runner.depth ? `${runner.depth} queued / running` : "Idle"}</span></div><details class="card history" ${latest ? "open" : ""}><summary>Recent activity <span class="muted">${runner.history.length} runs · resets on restart</span></summary>${runner.history.length ? runner.history.map((job) => `<details class="run" ${job === latest ? "open" : ""}><summary><strong>${escapeHtml(job.trigger)}</strong><span class="badge ${job.state === "failure" ? "failed" : ""}">${job.state}</span></summary><time>${escapeHtml(job.finishedAt ?? job.startedAt ?? "Waiting")}</time>${job.state === "failure" ? "<p>Check credentials, account mappings and service connectivity. Account failures appear in the result below.</p>" : ""}${job.result !== undefined ? renderResult(job.result) : ""}</details>`).join("") : `<p class="empty">Your first run will appear here. Start with a connection check.</p>`}</details></section>`;
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
    return `<div class="counts">${labels.map((key) => `<div><strong>${escapeHtml((value as Record<string, unknown>)[key])}</strong><span>${key}</span></div>`).join("")}</div>`;
  }
  if (
    typeof value === "object" &&
    value !== null &&
    "ok" in value &&
    value.ok === true
  )
    return "<p>Connections and mappings checked successfully.</p>";
  return `<pre>${escapeHtml(JSON.stringify(value, null, 2))}</pre>`;
}
