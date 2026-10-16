import type { AppConfig } from "./config.js";
import type { JobRunner } from "./job-runner.js";
import { getActualCredentials, settingsVersion } from "./settings-store.js";
import {
  connectionTestStatus,
  escapeHtml as e,
  pageHead,
  status,
  themeControl,
} from "./ui.js";

export type Discovery = {
  actual: Array<{ id: string; name: string }>;
  actualUnavailable?: boolean;
  up: Array<{ id: string; name: string; connections: string[] }>;
  unavailable: string[];
};

const card = "panel wa-stack";
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
  accountUpdates: ReadonlyMap<string, AccountUpdate> = new Map(),
): string {
  const revision = settingsVersion(config);
  const actualCredentials = getActualCredentials(config);
  const form = (action: string, content: string, confirmation?: string) =>
    `<form id="settings-${e(action)}-${content.match(/name="id" value="([^"]+)"/)?.[1] ?? "global"}" method="post" action="/settings" hx-post="/settings" hx-target="#setup" hx-select="#setup" hx-swap="outerHTML"${confirmation ? ` hx-confirm="${e(confirmation)}"` : ""}>${hidden("revision", revision)}${hidden("action", action)}<fieldset class="wa-stack" ${busy ? "disabled" : ""}>${content}</fieldset></form>`;
  const testConnection = (connection?: string) => {
    if (!connection && !actualCredentials) return "";
    const target = connection ? `up-${connection}` : "actual";
    return `<form method="post" action="/actions/test" hx-post="/actions/test" hx-target="#test-${e(target)}" hx-swap="outerHTML" hx-disabled-elt="find button">${hidden("target", connection ? "up" : "actual")}${connection ? hidden("connection", connection) : ""}<button class="wa-plain" title="Test the saved connection" aria-label="Test ${e(connection ? name(connection) : "Actual")} Connection"${busy ? " disabled" : ""}><span class="action-label">Test</span><span class="action-progress">Testing…</span></button></form>`;
  };
  const sync = (
    label: string,
    scope: { account?: string; connection?: string } = {},
    disabled = false,
  ) =>
    `<form method="post" action="/actions/sync" hx-post="/actions/sync" hx-target="#feedback" hx-disabled-elt="find button">${hidden("mode", "live")}${scope.account ? hidden("account", scope.account) : ""}${scope.connection ? hidden("connection", scope.connection) : ""}<button class="${scope.account || scope.connection ? "wa-plain" : "wa-brand"}" aria-label="${e(scope.account ? `Sync ${scope.account}` : scope.connection ? `Sync All Accounts in ${name(scope.connection)}` : "Sync All Accounts")}"${disabled || busy ? " disabled" : ""}><span class="action-label">${label}</span><span class="action-progress">Queuing…</span></button></form>`;
  const accountRow = (account: Discovery["up"][number], connection: string) =>
    accountSettingsRow(
      config,
      discovery,
      account,
      accountUpdates.get(account.id),
      connection,
    );
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
            connections: mapping.connections,
            id: mapping.upAccountId,
            name: mapping.alias,
          });
      const unavailable = discovery?.unavailable.includes(connection.id);
      return `<section class="${card}" data-connection="${e(connection.id)}"><div class="wa-split"><div class="section-intro"><h2>${e(name(connection.id))}</h2><p class="hint">Up · ${accounts.size} ${accounts.size === 1 ? "Account" : "Accounts"}</p></div><div class="wa-cluster section-actions"><wa-badge variant="${unavailable ? "warning" : discovery ? "success" : "neutral"}">${unavailable ? "Needs Attention" : discovery ? "Connected" : "Not Checked"}</wa-badge>${testConnection(connection.id)}${sync("Sync All", { connection: connection.id })}</div></div>${connectionTestStatus(`up-${connection.id}`)}<div id="connection-${e(connection.id)}" class="wa-stack">${form("connection", `${hidden("id", connection.id)}<label><span>Replace API Key</span><input type="password" name="token" autocomplete="new-password" maxlength="8192" required></label><button>Save Key</button>`)}${!mapped.length ? form("remove-connection", `${hidden("id", connection.id)}<button class="wa-danger">Remove Connection</button>`, "Remove this connection and its saved API key?") : '<p class="hint">Disconnect its accounts before removing this connection.</p>'}</div>${[...accounts.values()].map((account) => accountRow(account, connection.id)).join("") || '<p class="hint">Accounts will appear here after discovery.</p>'}</section>`;
    })
    .join("");
  return `<!doctype html><html lang="en-AU"><head>${pageHead}<script src="/assets/htmx.js" defer></script><title>Actual Up</title></head><body hx-history="false"><header class="wa-split"><div class="app-title"><a href="/">Actual Up</a>${themeControl}</div><div class="wa-cluster"><form method="post" action="/logout"><button class="wa-plain">Sign Out</button></form></div></header><main id="setup" class="wa-stack" ${busy ? ' hx-get="/?pending=1" hx-trigger="every 2s" hx-select="#setup" hx-swap="outerHTML"' : ""}>

  <div class="wa-split"><div class="section-intro"><h1>Accounts &amp; Sync</h1><p class="hint">Up → Actual Budget · Regular sync checks the last ${config.schedule.lookbackDays} days.</p></div><div class="wa-cluster"><wa-badge variant="${config.schedule.enabled ? "success" : "warning"}">${config.schedule.enabled ? "Automatic Sync On" : "Automatic Sync Off"}</wa-badge>${sync("Sync All", {}, config.mappings.length === 0)}</div></div>
  <div id="feedback" class="hint" role="status" aria-live="polite">${busy ? "Updating connections…" : e(message)}</div>
  ${status(runner, config.schedule.timezone, config.schedule)}
  <section class="${card}"><div class="wa-split"><div class="section-intro"><h2>Actual Budget</h2><p class="hint">Destination for your transactions</p></div><div class="wa-cluster section-actions"><wa-badge variant="${discovery?.actualUnavailable ? "warning" : actualCredentials && discovery ? "success" : "neutral"}">${discovery?.actualUnavailable ? "Needs Attention" : actualCredentials && discovery ? "Connected" : actualCredentials ? "Configured" : "Set Up Required"}</wa-badge>${testConnection()}</div></div>${connectionTestStatus("actual")}<div id="actual-settings" class="wa-stack">${form(
    "actual",
    `<div class="wa-grid"><label><span>Server URL</span><input type="url" name="serverUrl" value="${e(config.actual.serverUrl)}" required></label><label><span>Budget Sync ID</span><input name="syncId" value="${e(config.actual.syncId ?? "")}" required></label></div><div class="wa-grid"><label><span>Authentication</span><select name="method">${options(
      [
        { id: "session", name: "Session Token" },
        { id: "password", name: "Password" },
      ],
      actualCredentials?.method ?? "session",
    )}</select></label><label><span>Session Token or Password</span><input type="password" name="credential" autocomplete="new-password" ${actualCredentials ? 'placeholder="Leave blank to keep saved credential"' : "required"}></label></div><label><span>Budget Encryption Password (Optional)</span><input type="password" name="encryptionPassword" autocomplete="new-password" placeholder="Leave blank to keep saved password"></label>${actualCredentials?.encryptionPassword ? '<label class="wa-cluster"><input type="checkbox" name="clearEncryption" value="true">Remove Saved Encryption Password</label>' : ""}<p class="hint">Tests these details before saving.${actualCredentials ? " The Test button above checks the saved connection." : ""}</p><button class="wa-brand">Test &amp; Save Connection</button>`,
  )}</div></section>
  <div class="wa-stack">${connections}<section class="${card}"><div id="add-connection" class="wa-stack"><h2>Add Connection</h2>${form("connection", `<div class="wa-grid"><label><span>Name</span><input name="id" pattern="[a-z]([a-z0-9]|-)*" maxlength="80" placeholder="e.g. max" required></label><label><span>Up API Key</span><input name="token" type="password" autocomplete="new-password" maxlength="8192" required></label></div><p class="hint">Use a short name with lowercase letters, numbers or hyphens. Your key is encrypted and accounts are discovered automatically.</p><button class="wa-brand">Add Connection</button>`)}</div></section></div>

  <section id="automation-tools" class="panel wa-stack"><h2>Automation &amp; Tools</h2><div class="wa-stack"><p>Recent Sync: ${e(config.schedule.cron === "*/15 * * * *" ? "Every 15 Minutes" : config.schedule.cron)} · Full Backfill: ${e(config.schedule.backfillCron === "0 3 * * *" ? "Nightly at 03:00" : config.schedule.backfillCron)} · ${e(config.schedule.timezone)}</p><div class="wa-cluster">${form("discover", '<button class="wa-plain">Refresh Accounts</button>')}<form method="post" action="/actions/validate" hx-post="/actions/validate" hx-target="#feedback"><button class="wa-plain">Check Connections</button></form></div></div></section>
  </main></body></html>`;
}

export type AccountUpdate = {
  pending: boolean;
  message: string;
  failed?: boolean;
};

export function accountSettingsRow(
  config: AppConfig,
  discovery: Discovery | undefined,
  account: Discovery["up"][number],
  update?: AccountUpdate,
  viewConnection = account.connections[0] ?? "",
): string {
  const mapping = config.mappings.find(
    ({ upAccountId }) => upAccountId === account.id,
  );
  const connections = [
    ...new Set([...(mapping?.connections ?? []), ...account.connections]),
  ];
  const destination = discovery?.actual.find(
    ({ id }) => id === mapping?.actualAccountId,
  )?.name;
  const form = (action: string, content: string, confirmation?: string) =>
    `<form id="settings-${e(action)}-${e(viewConnection)}-${e(account.id)}" method="post" action="/settings" hx-post="/settings" hx-target="closest .account-row" hx-swap="outerHTML" hx-disabled-elt="find fieldset"${confirmation ? ` hx-confirm="${e(confirmation)}"` : ""}>${hidden("revision", settingsVersion(config, account.id))}${hidden("action", action)}${hidden("upAccountId", account.id)}${hidden("viewConnection", viewConnection)}<fieldset class="wa-stack" ${update?.pending ? "disabled" : ""}>${content}</fieldset></form>`;
  const editor =
    discovery && !discovery.actualUnavailable
      ? form(
          "mapping",
          `
    <div class="wa-grid">
      <label><span>Account Name</span><input name="alias" value="${e(mapping?.alias ?? account.name)}" maxlength="80" required></label>
      <label><span>Actual Account</span>${mapping ? `${hidden("actualAccountId", mapping.actualAccountId)}<input aria-label="Actual Account" value="${e(destination ?? "Linked Account")}" readonly>` : `<select name="actualAccountId" aria-label="Actual Account" required><option value="">Choose an Account</option>${options((discovery.actual ?? []).filter(({ id }) => !config.mappings.some(({ actualAccountId }) => actualAccountId === id)))}</select>`}</label>
      <button class="wa-brand"><span class="action-label">${mapping ? "Save Changes" : "Connect Account"}</span><span class="action-progress">Queuing…</span></button>
    </div>
    ${connections.length > 1 ? `<div class="wa-cluster"><span class="hint">Use Connections</span>${connections.map((id) => `<label class="wa-cluster"><input type="checkbox" name="connections" value="${e(id)}"${(mapping?.connections ?? account.connections).includes(id) ? " checked" : ""}>${e(name(id))}</label>`).join("")}</div>` : hidden("connections", connections[0] ?? "")}
    ${!mapping && config.schedule.enabled ? '<p class="hint">Connecting imports full history automatically. Saving account edits does not start another backfill.</p>' : ""}
  `,
        )
      : '<p class="hint">Connect to Actual or refresh the connection to choose an account.</p>';
  return `<div class="account-row wa-stack" id="account-${e(viewConnection)}-${e(account.id)}" data-account="${e(account.id)}"${update?.pending ? ` hx-get="/accounts/${encodeURIComponent(account.id)}?connection=${encodeURIComponent(viewConnection)}" hx-trigger="every 1s" hx-swap="outerHTML"` : ""}>
    <div class="wa-split"><div class="section-intro"><div class="wa-cluster"><h3>${e(mapping?.alias ?? account.name)}</h3>${connections.length > 1 ? '<wa-badge variant="neutral">Shared</wa-badge>' : ""}</div>${mapping ? `<p class="hint">→ ${e(destination ?? "Actual Budget")}</p>` : ""}</div>
    ${mapping ? `<form method="post" action="/actions/sync" hx-post="/actions/sync" hx-target="#feedback" hx-disabled-elt="find button">${hidden("account", mapping.alias)}${hidden("mode", "live")}<button class="wa-plain" aria-label="Sync ${e(mapping.alias)}"><span class="action-label">Sync</span><span class="action-progress">Queuing…</span></button></form>` : ""}</div>
    ${mapping ? `<div id="edit-${e(viewConnection)}-${e(account.id)}" class="wa-stack" aria-label="Manage ${e(mapping.alias)}">${editor}<div class="wa-split"><form id="backfill-${e(viewConnection)}-${e(account.id)}" class="wa-cluster" method="post" action="/actions/sync" hx-post="/actions/sync" hx-target="#feedback" hx-disabled-elt="find button">${hidden("account", mapping.alias)}<label><span>From Date</span><input type="date" name="since" value="1970-01-01" required></label><button class="wa-plain" name="mode" value="dry-run">Preview</button><button name="mode" value="live">Backfill</button><p class="hint">Preview or import from this date. Regular Sync checks the last ${config.schedule.lookbackDays} days.</p></form>${form("remove-mapping", '<button class="wa-danger">Disconnect</button>', "Stop syncing this account? Existing Actual transactions will remain.")}</div></div>` : `<div class="wa-stack">${editor}</div>`}
    ${update?.message ? `<p class="hint" role="status">${e(update.message)}</p>` : ""}
  </div>`;
}
