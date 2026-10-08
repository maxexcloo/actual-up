import type { AppConfig } from "./config.js";
import { getActualCredentials, settingsVersion } from "./settings-store.js";
import { escapeHtml as e } from "./ui.js";

export type Discovery = {
  actual: Array<{ id: string; name: string }>;
  up: Array<{ id: string; name: string; connections: string[] }>;
  unavailable: string[];
};

export function settingsPage(
  config: AppConfig,
  discovery: Discovery | undefined,
  busy: boolean,
  message: string,
): string {
  const revision = settingsVersion(config);
  const actualCredentials = getActualCredentials(config);
  const hidden = (name: string, value: string) =>
    `<input type="hidden" name="${name}" value="${e(value)}">`;
  const form = (action: string, content: string, confirmation?: string) =>
    `<form method="post" action="/settings" hx-post="/settings" hx-target="#setup" hx-select="#setup" hx-swap="outerHTML"${confirmation ? ` hx-confirm="${e(confirmation)}"` : ""}>${hidden("revision", revision)}${hidden("action", action)}<fieldset class="space-y-3" ${busy ? "disabled" : ""}>${content}</fieldset></form>`;
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
  const card = "card border border-base-300 bg-base-100";
  return `<!doctype html><html lang="en-AU"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="htmx-config" content='{"allowEval":false,"allowScriptTags":false,"includeIndicatorStyles":false,"historyCacheSize":0,"responseHandling":[{"code":"204","swap":false},{"code":"[23]..","swap":true},{"code":"[45]..","swap":true,"error":true}]}'><title>Accounts &amp; Connections · Actual Up</title><link rel="stylesheet" href="/assets/style.css"><script src="/assets/htmx.js" defer></script></head><body class="min-h-screen bg-base-200/50" hx-history="false"><main id="setup" class="mx-auto max-w-4xl px-4 pb-8 sm:px-6"${busy ? ' hx-get="/settings" hx-trigger="every 2s" hx-select="#setup" hx-swap="outerHTML"' : ""}>
  <header class="flex h-18 items-center justify-between border-b border-base-300"><a href="/" class="text-lg font-semibold">↗ Actual Up</a><a href="/" class="btn btn-ghost btn-sm">Back to Sync</a></header>
  <h1 class="mt-7 text-2xl font-semibold tracking-tight">Accounts &amp; Connections</h1><p class="mt-2 text-sm text-base-content/65">Connect your Up accounts to Actual Budget. Manage API keys and account mappings in one place.</p>
  <div class="alert my-5 text-sm" role="status" aria-live="polite">${busy ? '<span class="loading loading-spinner loading-sm" aria-hidden="true"></span>' : ""}<span>${e(message)}</span></div>
  <section class="${card} mb-5"><div class="card-body p-5 sm:p-6"><h2 class="card-title text-base">Actual Budget</h2><p class="text-sm text-base-content/65">Connect your budget. Use a session token for an Actual server with single sign-on.</p><details ${actualCredentials ? "" : "open"}><summary class="cursor-pointer text-sm">${actualCredentials ? "Edit Connection" : "Set Up Connection"}</summary><div class="mt-4">${form(
    "actual",
    `<label class="block"><span class="mb-1 block text-sm">Server URL</span><input class="input w-full" type="url" name="serverUrl" value="${e(config.actual.serverUrl)}" required></label><label class="block"><span class="mb-1 block text-sm">Budget Sync ID</span><input class="input w-full" name="syncId" value="${e(config.actual.syncId ?? "")}" required></label><label class="block"><span class="mb-1 block text-sm">Authentication</span><select class="select w-full" name="method">${options(
      [
        { id: "session", name: "Session Token" },
        { id: "password", name: "Password" },
      ],
      actualCredentials?.method ?? "session",
    )}</select></label><label class="block"><span class="mb-1 block text-sm">Session Token or Password</span><input class="input w-full" type="password" name="credential" autocomplete="new-password" ${actualCredentials ? 'placeholder="Leave blank to keep the saved credential"' : "required"}></label><label class="block"><span class="mb-1 block text-sm">Budget Encryption Password (Optional)</span><input class="input w-full" type="password" name="encryptionPassword" autocomplete="new-password" placeholder="Leave blank to keep the saved password"></label>${actualCredentials?.encryptionPassword ? '<label class="flex items-center gap-2 text-sm"><input class="checkbox checkbox-sm" type="checkbox" name="clearEncryption" value="true">Remove Saved Encryption Password</label>' : ""}<button class="btn btn-primary btn-sm">Save Actual Connection</button>`,
  )}</div></details></div></section>
  <section class="${card}"><div class="card-body p-5 sm:p-6"><h2 class="card-title text-base">API Keys</h2><p class="text-sm text-base-content/65">Keys are encrypted on the server and checked before saving. Saved keys are never displayed.</p>
  <div class="my-3 space-y-3">${config.up.connections.map((connection) => `<div class="rounded-lg border border-base-300 p-4"><div class="flex items-center justify-between gap-3"><strong>${e(connection.id)}</strong>${config.mappings.some(({ connections }) => connections.includes(connection.id)) ? '<span class="badge badge-ghost badge-sm">In Use</span>' : form("remove-connection", `${hidden("id", connection.id)}<button class="btn btn-ghost btn-sm">Remove Key</button>`, "Remove this API key?")}</div><details class="mt-3"><summary class="cursor-pointer text-sm">Replace Key</summary><div class="mt-3">${form("connection", `${hidden("id", connection.id)}<label><span class="mb-1 block text-sm">New API Key</span><input class="input w-full" type="password" name="token" autocomplete="new-password" spellcheck="false" maxlength="8192" required></label><button class="btn btn-sm">Save Key</button>`)}</div></details></div>`).join("")}</div>
  <details ${config.up.connections.length ? "" : "open"}><summary class="cursor-pointer font-medium">Add API Key</summary><div class="mt-4">${form("connection", `<div class="grid gap-3 sm:grid-cols-2"><label><span class="mb-1 block text-sm">Name</span><input class="input w-full" name="id" pattern="[a-z]([a-z0-9]|-)*" maxlength="80" placeholder="e.g. max" required></label><label><span class="mb-1 block text-sm">API Key</span><input class="input w-full" name="token" type="password" autocomplete="new-password" spellcheck="false" maxlength="8192" required></label></div><p class="text-xs text-base-content/65">Use a short name with lowercase letters, numbers or hyphens.</p><button class="btn btn-primary btn-sm">Save Key</button>`)}</div></details>
  </div></section>
  <section class="${card} mt-5"><div class="card-body p-5 sm:p-6"><div class="flex flex-wrap items-center justify-between gap-3"><h2 class="card-title text-base">Account Mappings</h2>${form("discover", '<button class="btn btn-sm">Refresh Accounts</button>')}</div>
  <p class="text-sm text-base-content/65">Each Up account imports once. Select multiple keys for shared access; fallback follows the displayed order. Saving a mapping ${config.schedule.enabled ? "automatically backfills its history" : "leaves automatic sync paused"}.</p>
  ${config.mappings.map((mapping) => `<div class="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-base-200/50 p-3"><div class="min-w-0"><strong>${e(mapping.alias)}</strong><p class="break-all text-xs text-base-content/65">${e(mapping.upAccountId)} → ${e(mapping.actualAccountId)}</p><p class="text-xs text-base-content/65">${e(mapping.connections.join(" → "))}</p></div>${form("remove-mapping", `${hidden("upAccountId", mapping.upAccountId)}<button class="btn btn-ghost btn-sm">Disconnect</button>`, "Stop syncing this account? Existing transactions remain in Actual.")}</div>`).join("")}
  ${
    discovery
      ? discovery.up
          .map((account) => {
            const mapping = config.mappings.find(
              ({ upAccountId }) => upAccountId === account.id,
            );
            const connections = [
              ...new Set([
                ...(mapping?.connections ?? []),
                ...account.connections,
              ]),
            ];
            return `<div class="mt-4 border-t border-base-300 pt-4"><h3 class="mb-3 font-medium">${e(account.name)}</h3>${form("mapping", `${hidden("upAccountId", account.id)}<div class="grid gap-3 sm:grid-cols-2"><label><span class="mb-1 block text-sm">Account Name</span><input class="input w-full" name="alias" value="${e(mapping?.alias ?? account.name)}" maxlength="80" required></label><label><span class="mb-1 block text-sm">Actual Account</span>${mapping ? `${hidden("actualAccountId", mapping.actualAccountId)}<span class="input flex w-full items-center">${e(discovery.actual.find(({ id }) => id === mapping.actualAccountId)?.name ?? mapping.actualAccountId)}</span>` : `<select class="select w-full" name="actualAccountId" required><option value="">Select an Account</option>${options(discovery.actual.filter(({ id }) => !config.mappings.some(({ actualAccountId }) => actualAccountId === id)))}</select>`}</label></div><fieldset><legend class="mb-2 text-sm">API Keys</legend><div class="flex flex-wrap gap-4">${connections.map((id) => `<label class="flex items-center gap-2 text-sm"><input class="checkbox checkbox-sm" type="checkbox" name="connections" value="${e(id)}"${(mapping?.connections ?? account.connections).includes(id) ? " checked" : ""}>${e(id)}${discovery.unavailable.includes(id) ? " (Unavailable)" : ""}</label>`).join("")}</div></fieldset><button class="btn btn-primary btn-sm">${mapping ? "Save Mapping" : "Connect Account"}</button>`, config.schedule.enabled ? "Save this mapping and import its transaction history into Actual?" : undefined)}</div>`;
          })
          .join("") ||
        '<p class="mt-3 text-sm">No accessible Up accounts were found.</p>'
      : '<p class="mt-3 text-sm text-base-content/65">Refresh accounts to add or edit mappings.</p>'
  }
  </div></section></main></body></html>`;
}
