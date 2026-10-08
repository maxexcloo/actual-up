import type { AccountMapping, AppConfig } from "./config.js";
import type { JobRunner } from "./job-runner.js";
import { getActualCredentials, settingsVersion } from "./settings-store.js";
import { connectionTestStatus, escapeHtml as e, status } from "./ui.js";

export type Discovery = {
  actual: Array<{ id: string; name: string }>;
  actualUnavailable?: boolean;
  up: Array<{ id: string; name: string; connections: string[] }>;
  unavailable: string[];
};

const card = "rounded-xl border border-base-300 bg-base-100";
const hidden = (name: string, value: string) =>
  `<input type="hidden" name="${name}" value="${e(value)}">`;
const name = (id: string) =>
  id
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
const options = (
  values: Array<{ id: string; name: string }>,
  selected?: string,
) =>
  values
    .map(
      ({ id, name }) =>
        `<option value="${e(id)}"${id === selected ? " selected" : ""}>${e(name)}</option>`,
    )
    .join("");

export function settingsPage(
  config: AppConfig,
  discovery: Discovery | undefined,
  busy: boolean,
  message: string,
  runner: JobRunner,
): string {
  const revision = settingsVersion(config);
  const actualCredentials = getActualCredentials(config);
  const form = (action: string, content: string, confirmation?: string) =>
    `<form method="post" action="/settings" hx-post="/settings" hx-target="#setup" hx-select="#setup" hx-swap="outerHTML"${confirmation ? ` hx-confirm="${e(confirmation)}"` : ""}>${hidden("revision", revision)}${hidden("action", action)}<fieldset class="space-y-3" ${busy ? "disabled" : ""}>${content}</fieldset></form>`;
  const testConnection = (connection?: string) => {
    if (!connection && !actualCredentials) return "";
    const target = connection ? `up-${connection}` : "actual";
    return `<div class="flex flex-col items-end gap-1"><form method="post" action="/actions/test" hx-post="/actions/test" hx-target="#test-${e(target)}" hx-swap="outerHTML" hx-disabled-elt="find button">${hidden("target", connection ? "up" : "actual")}${connection ? hidden("connection", connection) : ""}<button class="btn btn-ghost btn-sm" title="Test the saved connection" aria-label="Test ${e(connection ? name(connection) : "Actual")} Connection"${busy ? " disabled" : ""}><span class="action-label">Test</span><span class="action-progress">Testing…</span></button></form>${connectionTestStatus(target)}</div>`;
  };
  const sync = (
    label: string,
    scope: { account?: string; connection?: string } = {},
    disabled = false,
  ) =>
    `<form method="post" action="/actions/sync" hx-post="/actions/sync" hx-target="#feedback" hx-disabled-elt="find button">${hidden("mode", "live")}${scope.account ? hidden("account", scope.account) : ""}${scope.connection ? hidden("connection", scope.connection) : ""}<button class="btn btn-sm ${scope.account || scope.connection ? "btn-ghost" : "btn-primary"}" aria-label="${e(scope.account ? `Sync ${scope.account}` : scope.connection ? `Sync All Accounts in ${name(scope.connection)}` : "Sync All Accounts")}"${disabled || busy ? " disabled" : ""}><span class="action-label">${label}</span><span class="action-progress">Queuing…</span></button></form>`;
  const mappingForm = (
    account: Discovery["up"][number],
    mapping?: AccountMapping,
  ) => {
    const connections = [
      ...new Set([...(mapping?.connections ?? []), ...account.connections]),
    ];
    return form(
      "mapping",
      `${hidden("upAccountId", account.id)}<div class="grid gap-3 sm:grid-cols-2"><label><span class="mb-1 block text-sm">Account Name</span><input class="input w-full" name="alias" value="${e(mapping?.alias ?? account.name)}" maxlength="80" required></label><label><span class="mb-1 block text-sm">Actual Account</span>${mapping ? `${hidden("actualAccountId", mapping.actualAccountId)}<span class="input flex w-full items-center">${e(discovery?.actual.find(({ id }) => id === mapping.actualAccountId)?.name ?? "Linked Account")}</span>` : `<select class="select w-full" name="actualAccountId" required><option value="">Choose an Account</option>${options((discovery?.actual ?? []).filter(({ id }) => !config.mappings.some(({ actualAccountId }) => actualAccountId === id)))}</select>`}</label></div><fieldset><legend class="mb-2 text-sm">Use Connections</legend><div class="flex flex-wrap gap-4">${connections.map((id) => `<label class="flex items-center gap-2 text-sm"><input class="checkbox checkbox-sm" type="checkbox" name="connections" value="${e(id)}"${(mapping?.connections ?? account.connections).includes(id) ? " checked" : ""}>${e(name(id))}${discovery?.unavailable.includes(id) ? " (Unavailable)" : ""}</label>`).join("")}</div></fieldset><button class="btn btn-primary btn-sm">${mapping ? "Save Changes" : "Connect Account"}</button>`,
      config.schedule.enabled
        ? "Save this mapping and backfill its history into Actual?"
        : undefined,
    );
  };
  const accountRow = (account: Discovery["up"][number]) => {
    const mapping = config.mappings.find(
      ({ upAccountId }) => upAccountId === account.id,
    );
    const destination = discovery?.actual.find(
      ({ id }) => id === mapping?.actualAccountId,
    )?.name;
    const shared = (mapping?.connections ?? account.connections).length > 1;
    return `<div class="account-row border-t border-base-200 px-5 py-3 sm:px-6" data-account="${e(account.id)}"><div class="grid grid-cols-[1fr_auto] gap-x-3"><details class="account-editor col-span-2 col-start-1 row-start-1"><summary class="cursor-pointer pr-24" aria-label="Manage ${e(mapping?.alias ?? account.name)}"><div class="flex flex-wrap items-center gap-2"><h3 class="font-medium">${e(mapping?.alias ?? account.name)}</h3>${shared ? '<span class="badge badge-ghost badge-xs">Shared</span>' : ""}<span class="disclosure text-xs text-base-content/40" aria-hidden="true">⌄</span></div><p class="mt-1 text-sm text-base-content/60">${mapping ? `→ ${e(destination ?? "Actual Budget")}` : "Choose an Actual Account"}</p></summary><div class="mt-4 space-y-4 pb-2">${discovery && !discovery.actualUnavailable ? mappingForm(account, mapping) : '<p class="text-sm text-base-content/65">Connect to Actual or refresh the connection to choose an account.</p>'}${mapping ? `<div class="flex flex-wrap items-end gap-3 border-t border-base-200 pt-4"><form class="flex flex-wrap items-end gap-2" method="post" action="/actions/sync" hx-post="/actions/sync" hx-target="#feedback" hx-disabled-elt="find button">${hidden("account", mapping.alias)}<label><span class="mb-1 block text-xs">Backfill From (Optional)</span><input class="input input-sm" type="date" name="since"></label><button class="btn btn-ghost btn-sm" name="mode" value="dry-run">Preview</button><button class="btn btn-ghost btn-sm" name="mode" value="live">Backfill</button></form>${form("remove-mapping", `${hidden("upAccountId", account.id)}<button class="btn btn-ghost btn-sm text-error">Disconnect</button>`, "Stop syncing this account? Existing Actual transactions will remain.")}</div>` : ""}<details class="text-xs text-base-content/55"><summary class="cursor-pointer">Technical Details</summary><p class="mt-2 break-all">Up: ${e(account.id)}${mapping ? `<br>Actual: ${e(mapping.actualAccountId)}` : ""}</p></details></div></details>${mapping ? `<div class="col-start-2 row-start-1 self-start">${sync("Sync", { account: mapping.alias })}</div>` : ""}</div></div>`;
  };
  const connections = config.up.connections
    .map((connection) => {
      const accounts = new Map(
        (discovery?.up ?? [])
          .filter(({ connections }) => connections.includes(connection.id))
          .map((account) => [account.id, account]),
      );
      const mapped = config.mappings.filter(({ connections }) =>
        connections.includes(connection.id),
      );
      for (const mapping of mapped)
        if (!accounts.has(mapping.upAccountId))
          accounts.set(mapping.upAccountId, {
            id: mapping.upAccountId,
            name: mapping.alias,
            connections: mapping.connections,
          });
      const unavailable = discovery?.unavailable.includes(connection.id);
      return `<section class="${card}" data-connection="${e(connection.id)}"><div class="px-5 py-4 sm:px-6"><div class="flex flex-wrap items-center justify-between gap-3"><div class="flex items-center gap-3"><span class="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary font-semibold" aria-hidden="true">↑</span><div><h2 class="font-semibold">${e(name(connection.id))}</h2><p class="text-xs text-base-content/60">Up · ${accounts.size} ${accounts.size === 1 ? "Account" : "Accounts"}</p></div><span class="badge badge-soft badge-sm ${unavailable ? "badge-warning" : discovery ? "badge-success" : "badge-ghost"}">${unavailable ? "Needs Attention" : discovery ? "Connected" : "Not Checked"}</span></div><div class="flex flex-wrap items-start gap-2">${testConnection(connection.id)}${sync("Sync All", { connection: connection.id }, !mapped.length)}</div></div><details class="mt-3"><summary class="cursor-pointer text-xs text-base-content/65">Connection Settings</summary><div class="mt-4 space-y-3">${form("connection", `${hidden("id", connection.id)}<label class="block"><span class="mb-1 block text-sm">Replace API Key</span><input class="input w-full" type="password" name="token" autocomplete="new-password" maxlength="8192" required></label><button class="btn btn-sm">Save Key</button>`)}${!mapped.length ? form("remove-connection", `${hidden("id", connection.id)}<button class="btn btn-ghost btn-sm text-error">Remove Connection</button>`, "Remove this connection and its saved API key?") : '<p class="text-xs text-base-content/60">Disconnect its accounts before removing this connection.</p>'}</div></details></div>${[...accounts.values()].map(accountRow).join("") || '<p class="border-t border-base-200 px-5 py-5 text-sm text-base-content/60">Accounts will appear here after discovery.</p>'}</section>`;
    })
    .join("");
  return `<!doctype html><html lang="en-AU"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="htmx-config" content='{"allowEval":false,"allowScriptTags":false,"includeIndicatorStyles":false,"historyCacheSize":0,"responseHandling":[{"code":"204","swap":false},{"code":"[23]..","swap":true},{"code":"[45]..","swap":true,"error":true}]}'><title>Actual Up</title><link rel="stylesheet" href="/assets/style.css"><script src="/assets/htmx.js" defer></script></head><body class="min-h-screen bg-base-200/50" hx-history="false"><main id="setup" class="mx-auto max-w-4xl px-4 pb-8 sm:px-6"${busy ? ' hx-get="/?pending=1" hx-trigger="every 2s" hx-select="#setup" hx-swap="outerHTML"' : ""}>
  <header class="flex h-18 items-center justify-between border-b border-base-300"><a href="/" class="text-lg font-semibold tracking-tight">↗ Actual Up</a><form method="post" action="/logout"><button class="btn btn-ghost btn-sm">Sign Out</button></form></header>
  <div class="flex flex-wrap items-center justify-between gap-4 py-7"><div><h1 class="text-2xl font-semibold tracking-tight">Connections</h1><p class="mt-1 text-sm text-base-content/60">Your accounts, kept in sync.</p></div><div class="flex items-center gap-3"><span class="badge badge-outline badge-sm ${config.schedule.enabled ? "badge-success" : "badge-warning"}">${config.schedule.enabled ? "Automatic Sync On" : "Automatic Sync Off"}</span>${sync("Sync All", {}, !config.mappings.length)}</div></div>
  <div id="feedback" class="mb-3 text-sm text-base-content/65" role="status" aria-live="polite">${busy ? '<span class="loading loading-spinner loading-xs mr-2" aria-hidden="true"></span>Updating connections…' : e(message)}</div>
  <section class="${card} mb-5"><div class="p-5 sm:px-6"><div class="flex flex-wrap items-center justify-between gap-2"><div><h2 class="font-semibold">Actual Budget</h2><p class="mt-1 text-xs text-base-content/60">Destination for your transactions</p></div><span class="badge badge-soft badge-sm ${discovery?.actualUnavailable ? "badge-warning" : actualCredentials ? "badge-success" : "badge-ghost"}">${discovery?.actualUnavailable ? "Needs Attention" : actualCredentials ? "Configured" : "Set Up Required"}</span>${testConnection()}</div><details class="mt-3" ${actualCredentials ? "" : "open"}><summary class="cursor-pointer text-xs text-base-content/65">${actualCredentials ? "Connection Settings" : "Connect Actual Budget"}</summary><div class="mt-4">${form(
    "actual",
    `<div class="grid gap-3 sm:grid-cols-2"><label><span class="mb-1 block text-sm">Server URL</span><input class="input w-full" type="url" name="serverUrl" value="${e(config.actual.serverUrl)}" required></label><label><span class="mb-1 block text-sm">Budget Sync ID</span><input class="input w-full" name="syncId" value="${e(config.actual.syncId ?? "")}" required></label></div><div class="grid gap-3 sm:grid-cols-2"><label><span class="mb-1 block text-sm">Authentication</span><select class="select w-full" name="method">${options(
      [
        { id: "session", name: "Session Token" },
        { id: "password", name: "Password" },
      ],
      actualCredentials?.method ?? "session",
    )}</select></label><label><span class="mb-1 block text-sm">Session Token or Password</span><input class="input w-full" type="password" name="credential" autocomplete="new-password" ${actualCredentials ? 'placeholder="Leave blank to keep saved credential"' : "required"}></label></div><label class="block"><span class="mb-1 block text-sm">Budget Encryption Password (Optional)</span><input class="input w-full" type="password" name="encryptionPassword" autocomplete="new-password" placeholder="Leave blank to keep saved password"></label>${actualCredentials?.encryptionPassword ? '<label class="flex items-center gap-2 text-sm"><input class="checkbox checkbox-sm" type="checkbox" name="clearEncryption" value="true">Remove Saved Encryption Password</label>' : ""}<p class="text-xs text-base-content/60">Tests these details before saving.${actualCredentials ? " The Test button above checks the saved connection." : ""}</p><button class="btn btn-primary btn-sm">Test &amp; Save Connection</button>`,
  )}</div></details></div></section>
  <div class="space-y-5">${connections}<section class="${card} p-5 sm:px-6"><details ${config.up.connections.length ? "" : "open"}><summary class="cursor-pointer text-sm font-medium">+ Add Connection</summary><div class="mt-4">${form("connection", `<div class="grid gap-3 sm:grid-cols-2"><label><span class="mb-1 block text-sm">Name</span><input class="input w-full" name="id" pattern="[a-z]([a-z0-9]|-)*" maxlength="80" placeholder="e.g. max" required></label><label><span class="mb-1 block text-sm">Up API Key</span><input class="input w-full" name="token" type="password" autocomplete="new-password" maxlength="8192" required></label></div><p class="text-xs text-base-content/60">Use a short name with lowercase letters, numbers or hyphens. Your key is encrypted and accounts are discovered automatically.</p><button class="btn btn-primary btn-sm">Add Connection</button>`)}</div></details></section></div>
  <details class="mt-6"><summary class="cursor-pointer text-sm font-medium">Recent Activity</summary><div class="mt-3">${status(runner, config.schedule.timezone)}</div></details>
  <details class="mt-5"><summary class="cursor-pointer text-sm text-base-content/65">Automation &amp; Tools</summary><div class="mt-3 space-y-3 text-sm text-base-content/65"><p>Recent Sync: ${e(config.schedule.cron === "*/15 * * * *" ? "Every 15 Minutes" : config.schedule.cron)} · Full Backfill: ${e(config.schedule.backfillCron === "0 3 * * *" ? "Nightly at 03:00" : config.schedule.backfillCron)} · ${e(config.schedule.timezone)}</p><div class="flex flex-wrap gap-3">${form("discover", '<button class="btn btn-ghost btn-sm">Refresh Accounts</button>')}<form method="post" action="/actions/validate" hx-post="/actions/validate" hx-target="#feedback"><button class="btn btn-ghost btn-sm">Check Connections</button></form></div></div></details>
  </main></body></html>`;
}
