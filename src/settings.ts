import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Server, IncomingMessage, ServerResponse } from "node:http";
import { Cron } from "croner";
import type { Logger } from "pino";
import type { AccountUpdate, ActionResponse, AppState, JobState } from "./api.js";
import { parseConfig, type AppConfig } from "./config.js";
import { discoverActualAccounts, discoverUpAccounts } from "./discovery.js";
import { ConfigError } from "./errors.js";
import type { JobRunner } from "./job-runner.js";
import type { Runtime } from "./runtime.js";
import { settingsCommand } from "./schemas.js";
import { changeSettingsVersion, saveSettings, settingsVersion } from "./settings-store.js";
import { HISTORY_START, type SyncEngine } from "./sync-engine.js";
import { UpClient } from "./up-client.js";
import type { UpClientLike } from "./types.js";

class SettingsError extends ConfigError {}

type Discovery = {
  actual: Array<{ id: string; name: string }>;
  actualUnavailable: boolean;
  up: Array<{ id: string; name: string; connections: string[] }>;
  unavailable: string[];
};

export function registerSettings(
  server: FastifyInstance<Server, IncomingMessage, ServerResponse, Logger>,
  config: AppConfig,
  runner: JobRunner,
  engine: SyncEngine,
  runtime: Pick<Runtime, "actual" | "clients">,
  logger: Logger,
  makeClient: (token: string, id: string) => UpClientLike = (token, id) =>
    new UpClient(token, logger.child({ connection: id })),
) {
  let discovery: Discovery | undefined;
  let busy = false;
  let message = "";
  let discoveryAttempted = false;
  const accountUpdates = new Map<string, AccountUpdate>();
  const discover = async (): Promise<Discovery> => {
    discoveryAttempted = true;
    let actual: Discovery["actual"] = [];
    let actualUnavailable = false;
    try {
      await runtime.actual.sync();
      actual = await discoverActualAccounts(runtime.actual);
    } catch {
      actualUnavailable = true;
    }
    const accounts = new Map<string, Discovery["up"][number]>();
    const unavailable: string[] = [];
    for (const [connection, client] of runtime.clients) {
      try {
        for (const { id, name } of await discoverUpAccounts(client)) {
          const account = accounts.get(id) ?? {
            id,
            name,
            connections: [],
          };
          account.connections.push(connection);
          accounts.set(id, account);
        }
      } catch {
        unavailable.push(connection);
      }
    }
    return {
      actual,
      actualUnavailable,
      up: [...accounts.values()],
      unavailable,
    };
  };

  const connectionTest = (target: string): JobState | undefined =>
    runner.history.find((job) => job.trigger === "test-connection" && job.scope?.target === target)
      ?.state;
  const state = (): AppState => {
    const credentials = config.secrets.actual;
    const accounts = new Map<string, AppState["accounts"][number]>();
    for (const { id, name, connections } of discovery?.up ?? [])
      accounts.set(id, { id, name, connections: [...connections], revision: "" });
    for (const mapping of config.mappings) {
      const account = accounts.get(mapping.upAccountId) ?? {
        id: mapping.upAccountId,
        name: mapping.alias,
        connections: [],
        revision: "",
      };
      account.connections = [...new Set([...mapping.connections, ...account.connections])];
      account.mapping = {
        alias: mapping.alias,
        actualAccountId: mapping.actualAccountId,
        actualAccountName: discovery?.actual.find(({ id }) => id === mapping.actualAccountId)?.name,
        connections: mapping.connections,
      };
      accounts.set(mapping.upAccountId, account);
    }
    for (const account of accounts.values()) {
      account.revision = settingsVersion(account.id);
      account.update = accountUpdates.get(account.id);
    }
    const cron = new Cron(config.schedule.cron, {
      paused: true,
      timezone: config.schedule.timezone,
    });
    const nextRun = config.schedule.enabled ? cron.nextRun()?.toISOString() : undefined;
    cron.stop();
    const body: Omit<AppState, "version"> = {
      revision: settingsVersion(),
      busy,
      message,
      schedule: {
        enabled: config.schedule.enabled,
        lookbackDays: config.schedule.lookbackDays,
        cron: config.schedule.cron,
        backfillCron: config.schedule.backfillCron,
        timezone: config.schedule.timezone,
        nextRun,
      },
      actual: {
        serverUrl: config.actual.serverUrl,
        syncId: config.actual.syncId ?? "",
        method: credentials?.method ?? "session",
        configured: Boolean(credentials),
        encryptionPassword: Boolean(credentials?.encryptionPassword),
        status: discovery?.actualUnavailable
          ? "attention"
          : credentials && discovery
            ? "connected"
            : credentials
              ? "configured"
              : "setup",
        test: connectionTest("actual"),
      },
      actualAccounts: discovery && !discovery.actualUnavailable ? discovery.actual : undefined,
      connections: config.up.connections.map(({ id }) => ({
        id,
        status: discovery?.unavailable.includes(id)
          ? "attention"
          : discovery
            ? "connected"
            : "unchecked",
        test: connectionTest(`up-${id}`),
      })),
      accounts: [...accounts.values()],
      jobs: [...runner.history],
    };
    const json = JSON.stringify(body);
    return { version: createHash("sha256").update(json).digest("base64url"), ...body };
  };

  server.get("/state", async (request, reply) => {
    if (!discoveryAttempted && !busy && config.up.connections.length) {
      busy = true;
      const accepted = runner.enqueue("settings", "settings", async () => {
        try {
          discovery = await discover();
          return { ok: true };
        } finally {
          busy = false;
        }
      });
      if (!accepted) busy = false;
    }
    const current = state();
    const etag = `"${current.version}"`;
    reply.header("ETag", etag);
    if (request.headers["if-none-match"] === etag) return reply.code(304).send();
    return current;
  });
  server.post("/settings", async (request, reply) => {
    const parsed = settingsCommand.safeParse(request.body);
    const accountId =
      parsed.success && "upAccountId" in parsed.data ? parsed.data.upAccountId : undefined;
    const revision = () => settingsVersion(accountId);
    const reject = (code: number, error: string) => reply.code(code).send({ error });
    if (!parsed.success) return reject(400, "Invalid settings. Reload the page and try again.");
    const command = parsed.data;
    if (
      busy ||
      (accountId
        ? accountUpdates.get(accountId)?.pending
        : [...accountUpdates.values()].some((update) => update.pending))
    )
      return reject(409, "Setup is already running. Wait for it to finish.");
    if (command.revision !== revision())
      return reject(409, "Settings changed. Reload before saving.");
    if (accountId)
      accountUpdates.set(accountId, {
        message: "Save queued. You can continue with other accounts.",
        pending: true,
      });
    else {
      busy = true;
      message = "Applying your changes…";
    }
    const accepted = runner.enqueue(
      accountId ? `settings:${accountId}` : "settings",
      "settings",
      async () => {
        let operationMessage = "Settings saved.";
        let failed = false;
        let saved = false;
        try {
          if (command.revision !== revision())
            throw new SettingsError("Settings changed. Reload before saving.");
          if (command.action === "discover") {
            discovery = await discover();
            operationMessage = discovery.unavailable.length
              ? "Some connections are unavailable. Replace their keys or retry; other connections can still sync."
              : "Accounts refreshed. Select the accounts to connect below.";
            return { ok: true };
          }
          const next = parseConfig(config);
          next.secrets = structuredClone(config.secrets);
          if (command.action === "actual") {
            if (
              config.mappings.length &&
              (command.syncId !== config.actual.syncId ||
                command.serverUrl !== config.actual.serverUrl)
            )
              throw new SettingsError(
                "Disconnect account mappings before switching Actual servers or budgets. Existing transactions remain in the previous budget.",
              );
            const previousCredentials = config.secrets.actual;
            const credential =
              command.credential ||
              (previousCredentials?.method === command.method
                ? previousCredentials.credential
                : "");
            if (!credential) throw new SettingsError("Enter the Actual session token or password.");
            next.actual = {
              cacheDirectory: config.actual.cacheDirectory,
              serverUrl: command.serverUrl,
              syncId: command.syncId,
            };
            next.secrets.actual = {
              credential,
              method: command.method,
              encryptionPassword: command.clearEncryption
                ? undefined
                : command.encryptionPassword || previousCredentials?.encryptionPassword,
            };
            const previous = { actual: config.actual, secrets: config.secrets };
            await runtime.actual.close();
            config.actual = next.actual;
            config.secrets = next.secrets;
            try {
              await runtime.actual.open();
              await saveSettings(next);
              changeSettingsVersion();
            } catch (error) {
              await runtime.actual.close();
              Object.assign(config, previous);
              // Version mismatches and missing setup explain themselves; upstream errors stay hidden.
              if (error instanceof ConfigError) throw error;
              throw new SettingsError(
                "Could not connect to Actual or save settings. Check the server, budget ID, credentials and storage. Previous settings were retained.",
              );
            }
            discovery = await discover();
            operationMessage = "Actual connection checked and saved.";
            return { ok: true };
          }
          let newClient: UpClientLike | undefined;
          if (command.action === "connection") {
            newClient = makeClient(command.token, command.id);
            await newClient.ping();
            const assigned = config.mappings.filter(({ connections }) =>
              connections.includes(command.id),
            );
            if (assigned.length) {
              const accessible = new Set((await newClient.listAccounts()).map(({ id }) => id));
              if (assigned.some(({ upAccountId }) => !accessible.has(upAccountId)))
                throw new SettingsError(
                  "This key cannot access all its mapped accounts. Update those mappings before replacing the key.",
                );
            }
            if (!next.up.connections.some(({ id }) => id === command.id))
              next.up.connections.push({ id: command.id });
            next.secrets.tokens[command.id] = command.token;
          } else if (command.action === "remove-connection") {
            if (next.mappings.some(({ connections }) => connections.includes(command.id)))
              throw new SettingsError(
                "This key is still in use. Update or disconnect its mappings first.",
              );
            delete next.secrets.tokens[command.id];
            next.up.connections = next.up.connections.filter(({ id }) => id !== command.id);
          } else if (command.action === "mapping") {
            const existing = next.mappings.find(
              ({ upAccountId }) => upAccountId === command.upAccountId,
            );
            if (existing && existing.actualAccountId !== command.actualAccountId)
              throw new SettingsError(
                "Disconnect the mapping before changing its Actual destination. Existing transactions will remain in the old account.",
              );
            const accessUnchanged =
              existing &&
              existing.connections.length === command.connections.length &&
              existing.connections.every((id, index) => id === command.connections[index]);
            if (!accessUnchanged) {
              discovery = await discover();
              const account = discovery.up.find(({ id }) => id === command.upAccountId);
              if (
                !account ||
                !command.connections.length ||
                new Set(command.connections).size !== command.connections.length ||
                !command.connections.every(
                  (id) =>
                    account.connections.includes(id) ||
                    (discovery!.unavailable.includes(id) &&
                      config.mappings.some(
                        (mapping) =>
                          mapping.upAccountId === command.upAccountId &&
                          mapping.connections.includes(id),
                      )),
                ) ||
                !command.connections.some((id) => account.connections.includes(id)) ||
                !discovery.actual.some(({ id }) => id === command.actualAccountId)
              )
                throw new SettingsError(
                  "The selected keys cannot access these accounts. Refresh accounts and choose an available key and destination.",
                );
            }
            const mapping = {
              actualAccountId: command.actualAccountId,
              alias: command.alias,
              connections: command.connections,
              upAccountId: command.upAccountId,
            };
            next.mappings = [
              ...next.mappings.filter(({ upAccountId }) => upAccountId !== command.upAccountId),
              mapping,
            ];
          } else {
            next.mappings = next.mappings.filter(
              ({ upAccountId }) => upAccountId !== command.upAccountId,
            );
          }
          // Cross-field validation also prevents deleting keys still used by a mapping.
          try {
            parseConfig(next);
          } catch {
            throw new SettingsError(
              "Account names must be unique, and each Up and Actual account can only be mapped once.",
            );
          }
          const newMapping =
            command.action === "mapping" &&
            !config.mappings.some(({ upAccountId }) => upAccountId === command.upAccountId);
          await saveSettings(next);
          config.up = next.up;
          config.mappings = next.mappings;
          config.secrets = next.secrets;
          changeSettingsVersion(accountId);
          saved = true;
          if (command.action === "connection" && newClient)
            runtime.clients.set(command.id, newClient);
          if (command.action === "remove-connection") runtime.clients.delete(command.id);
          if (!accountId) discovery = await discover();
          operationMessage = "Settings saved.";
          if (command.action === "mapping" && config.schedule.enabled && newMapping) {
            const queued = runner.enqueue(
              `backfill:${command.upAccountId}`,
              "automatic-backfill",
              async (progress) => {
                const mapping = config.mappings.find(
                  ({ upAccountId }) => upAccountId === command.upAccountId,
                );
                if (!mapping) return { ok: true };
                progress({ stage: "Refresh Actual" });
                await runtime.actual.sync();
                return engine.reconcile({
                  since: HISTORY_START,
                  mappingAliases: [mapping.alias],
                  progress,
                });
              },
              { account: command.alias, mode: "live", since: HISTORY_START },
            );
            operationMessage = queued
              ? "Saved. History backfill queued; you can continue with other accounts."
              : "Saved. Automatic sync will backfill this account.";
          }
          return { ok: true };
        } catch (error) {
          failed = true;
          operationMessage =
            error instanceof ConfigError
              ? error.message
              : saved
                ? "Settings saved, but accounts could not refresh. Reload the page to retry."
                : "Setup could not complete. Check the API key, Actual connection and writable storage, then retry.";
          throw new ConfigError(operationMessage);
        } finally {
          if (accountId)
            accountUpdates.set(accountId, {
              failed,
              message: operationMessage,
              pending: false,
            });
          else {
            busy = false;
            message = operationMessage;
          }
        }
      },
    );
    if (!accepted) {
      if (accountId)
        accountUpdates.set(accountId, {
          failed: true,
          message: "The queue is full. Please try again shortly.",
          pending: false,
        });
      else {
        busy = false;
        message = "The queue is full. Please try again shortly.";
      }
    }
    const response: ActionResponse = accepted
      ? { accepted, message: accountId ? "Save queued." : "Applying your changes…" }
      : { accepted, message: "The queue is full. Please try again shortly." };
    return reply.code(accepted ? 202 : 503).send(response);
  });
}
