import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { Server, IncomingMessage, ServerResponse } from "node:http";
import { Cron } from "croner";
import type { Logger } from "pino";
import type { z } from "zod";
import type { ActionResponse, AppState } from "./api.js";
import { parseConfig, type AppConfig } from "./config.js";
import { discoverActualAccounts, discoverUpAccounts } from "./discovery.js";
import { ConfigError } from "./errors.js";
import type { Runtime } from "./runtime.js";
import { HISTORY_START, mappingsRequest, settingsRequest } from "./schemas.js";
import { changeSettingsVersion, saveSettings, settingsVersion } from "./settings-store.js";
import { UpClient } from "./up-client.js";
import type { UpClientLike } from "./types.js";

type Discovery = {
  /** Unset when Actual could not be read. */
  actual?: Array<{ id: string; name: string }>;
  up: Map<string, { id: string; name: string; connections: string[] }>;
  unavailable: string[];
};

export function registerSettings(
  server: FastifyInstance<Server, IncomingMessage, ServerResponse, Logger>,
  config: AppConfig,
  runtime: Runtime,
  makeClient: (token: string, id: string) => UpClientLike = (token, id) =>
    new UpClient(token, runtime.logger.child({ connection: id })),
) {
  const { engine, runner } = runtime;
  let discovery: Discovery | undefined;
  let discoveryQueued = false;

  const discover = async () => {
    let actual: Discovery["actual"];
    try {
      await runtime.actual.sync();
      actual = await discoverActualAccounts(runtime.actual);
    } catch {
      actual = undefined;
    }
    const up: Discovery["up"] = new Map();
    const unavailable: string[] = [];
    for (const [connection, client] of runtime.clients) {
      try {
        for (const { id, name } of await discoverUpAccounts(client)) {
          const account = up.get(id) ?? { id, name, connections: [] };
          account.connections.push(connection);
          up.set(id, account);
        }
      } catch {
        unavailable.push(connection);
      }
    }
    discovery = { actual, up, unavailable };
  };
  const queueDiscovery = () =>
    runner.enqueue("discover", "discover", async () => {
      await discover();
      return { ok: true };
    });

  const state = (): AppState => {
    const credentials = config.secrets.actual;
    const accounts = new Map<string, AppState["accounts"][number]>();
    for (const { id, name, connections } of discovery?.up.values() ?? [])
      accounts.set(id, { id, name, connections: [...connections] });
    for (const { actualAccountId, alias, connections, upAccountId } of config.mappings) {
      const account = accounts.get(upAccountId) ?? {
        id: upAccountId,
        name: alias,
        connections: [],
      };
      account.connections = [...new Set([...connections, ...account.connections])];
      account.mapping = { alias, actualAccountId, connections };
      accounts.set(upAccountId, account);
    }
    const cron = new Cron(config.schedule.cron, {
      paused: true,
      timezone: config.schedule.timezone,
    });
    const nextRun = config.schedule.enabled ? cron.nextRun()?.toISOString() : undefined;
    cron.stop();
    const body: Omit<AppState, "version"> = {
      revisions: { mappings: settingsVersion("mappings"), settings: settingsVersion("settings") },
      schedule: { ...config.schedule, nextRun },
      actual: {
        serverUrl: config.actual.serverUrl,
        syncId: config.actual.syncId ?? "",
        method: credentials?.method ?? "session",
        configured: Boolean(credentials),
        encryptionPassword: Boolean(credentials?.encryptionPassword),
      },
      connections: config.up.connections.map(({ id }) => id),
      actualAccounts: discovery?.actual,
      unavailable: {
        actual: Boolean(credentials && discovery && !discovery.actual),
        connections: discovery?.unavailable ?? [],
      },
      accounts: [...accounts.values()],
      jobs: [...runner.history],
      logs: runtime.logs.entries,
    };
    const json = JSON.stringify(body);
    return { version: createHash("sha256").update(json).digest("base64url"), ...body };
  };

  const checkRevision = (form: "mappings" | "settings", revision: string) => {
    if (revision !== settingsVersion(form))
      throw new ConfigError("Settings changed elsewhere. Reload before saving.");
  };

  /** Check changed Actual details and Up keys, then commit everything together. */
  const applySettings = async (form: z.infer<typeof settingsRequest>): Promise<string> => {
    checkRevision("settings", form.revision);
    const previous = config.secrets.actual;
    const credential =
      form.actual.credential ||
      (previous?.method === form.actual.method ? previous.credential : "");
    if (!credential) throw new ConfigError("Enter the Actual session token or password.");
    const credentials = {
      credential,
      method: form.actual.method,
      encryptionPassword: form.actual.clearEncryption
        ? undefined
        : form.actual.encryptionPassword || previous?.encryptionPassword,
    };
    const moved =
      form.actual.serverUrl !== config.actual.serverUrl ||
      form.actual.syncId !== config.actual.syncId;
    if (moved && config.mappings.length)
      throw new ConfigError(
        "Disconnect all accounts before switching Actual servers or budgets. Existing transactions remain in the previous budget.",
      );
    const actualChanged =
      moved ||
      previous?.credential !== credentials.credential ||
      previous.method !== credentials.method ||
      previous.encryptionPassword !== credentials.encryptionPassword;

    const ids = new Set(form.connections.map(({ id }) => id));
    if (ids.size !== form.connections.length) throw new ConfigError("Key names must be unique.");
    const inUse = config.mappings.find(({ connections }) => connections.some((id) => !ids.has(id)));
    if (inUse)
      throw new ConfigError(`Disconnect ${inUse.alias} from a key before removing that key.`);
    const tokens: Record<string, string> = {};
    const changed = new Map<string, UpClientLike>();
    for (const { id, token } of form.connections) {
      const saved = config.secrets.tokens[id];
      if (!token && !saved) throw new ConfigError(`Enter an Up API key for ${id}.`);
      tokens[id] = token || saved!;
      if (token && token !== saved) changed.set(id, makeClient(token, id));
    }
    for (const [id, client] of changed) {
      const mapped = config.mappings.filter(({ connections }) => connections.includes(id));
      try {
        await client.ping();
        if (mapped.length) {
          const accessible = new Set((await client.listAccounts()).map(({ id }) => id));
          if (mapped.some(({ upAccountId }) => !accessible.has(upAccountId)))
            throw new ConfigError(
              `The ${id} key cannot access all its connected accounts. Update those accounts first.`,
            );
        }
      } catch (error) {
        if (error instanceof ConfigError) throw error;
        throw new ConfigError(`The ${id} key could not reach Up. Check the key and retry.`);
      }
    }

    const next = parseConfig({
      ...config,
      actual: { ...form.actual, cacheDirectory: config.actual.cacheDirectory },
      up: { connections: form.connections.map(({ id }) => ({ id })) },
    });
    checkRevision("settings", form.revision);
    const rollback = { actual: config.actual, secrets: config.secrets };
    if (actualChanged) await runtime.actual.close();
    config.actual = next.actual;
    config.secrets = { actual: credentials, tokens };
    try {
      if (actualChanged) await runtime.actual.open();
      await saveSettings({ ...config, up: next.up });
    } catch (error) {
      if (actualChanged) await runtime.actual.close();
      Object.assign(config, rollback);
      // Version mismatches and missing setup explain themselves; upstream errors stay hidden.
      if (error instanceof ConfigError) throw error;
      throw new ConfigError(
        "Could not connect to Actual or save settings. Check the server, budget ID, credentials and storage. Previous settings were retained.",
      );
    }
    config.up = next.up;
    for (const id of runtime.clients.keys()) if (!ids.has(id)) runtime.clients.delete(id);
    for (const [id, client] of changed) runtime.clients.set(id, client);
    changeSettingsVersion("settings");
    await discover();
    return "Settings saved.";
  };

  /** Mappings are checked against the last discovery, so saving never waits for a sync. */
  const applyMappings = async (form: z.infer<typeof mappingsRequest>): Promise<string> => {
    checkRevision("mappings", form.revision);
    const mappings = form.mappings.flatMap(({ actualAccountId, ...row }) =>
      actualAccountId ? [{ ...row, actualAccountId }] : [],
    );
    for (const mapping of mappings) {
      const existing = config.mappings.find(
        ({ upAccountId }) => upAccountId === mapping.upAccountId,
      );
      if (existing && existing.actualAccountId !== mapping.actualAccountId)
        throw new ConfigError(
          `Disconnect ${existing.alias} and save before choosing another Actual account. Existing transactions stay in the old account.`,
        );
      if (existing && existing.connections.join() === mapping.connections.join()) continue;
      const readable = discovery?.up.get(mapping.upAccountId)?.connections ?? [];
      if (
        !mapping.connections.some((id) => readable.includes(id)) ||
        (!existing && !discovery?.actual?.some(({ id }) => id === mapping.actualAccountId))
      )
        throw new ConfigError(
          `The selected keys cannot access ${mapping.alias}. Refresh accounts and choose an available key.`,
        );
    }
    let next: AppConfig;
    try {
      next = parseConfig({ ...config, mappings });
    } catch {
      throw new ConfigError(
        "Account names must be unique, and each Actual account can only be connected once.",
      );
    }
    const added = next.mappings.filter(
      ({ upAccountId }) => !config.mappings.some((mapping) => mapping.upAccountId === upAccountId),
    );
    await saveSettings({ ...config, mappings: next.mappings });
    config.mappings = next.mappings;
    changeSettingsVersion("mappings");
    if (!config.schedule.enabled || !added.length) return "Accounts saved.";
    for (const { upAccountId, alias } of added)
      runner.enqueue(
        `backfill:${upAccountId}`,
        "automatic-backfill",
        async (progress) => {
          const mapping = config.mappings.find((entry) => entry.upAccountId === upAccountId);
          if (!mapping) return { ok: true };
          return engine.reconcile({
            since: HISTORY_START,
            mappingAliases: [mapping.alias],
            progress,
          });
        },
        { account: alias, mode: "live", since: HISTORY_START },
      );
    return "Accounts saved. History backfill queued for new accounts.";
  };

  /** Run a settings change in the queue and wait, so the form receives the outcome. */
  const queued = (operation: () => Promise<string>) =>
    new Promise<string>((resolve, reject) => {
      const accepted = runner.enqueue("settings", "settings", async () => {
        try {
          resolve(await operation());
          return { ok: true };
        } catch (error) {
          reject(error);
          throw error;
        }
      });
      if (!accepted) reject(new ConfigError("Settings are already being saved. Please wait."));
    });

  const respond = async (reply: FastifyReply, operation: () => Promise<string>) => {
    try {
      const response: ActionResponse = { accepted: true, message: await operation() };
      return response;
    } catch (error) {
      return reply.code(error instanceof ConfigError ? 400 : 500).send({
        error:
          error instanceof ConfigError
            ? error.message
            : "Setup could not complete. Check the API key, Actual connection and writable storage, then retry.",
      });
    }
  };

  server.get("/state", async (request, reply) => {
    if (!discoveryQueued && (config.up.connections.length || config.secrets.actual))
      discoveryQueued = queueDiscovery();
    const current = state();
    const etag = `"${current.version}"`;
    reply.header("ETag", etag);
    if (request.headers["if-none-match"] === etag) return reply.code(304).send();
    return current;
  });

  server.post("/settings", async (request, reply) => {
    const parsed = settingsRequest.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: "Invalid settings. Reload the page and try again." });
    return respond(reply, () => queued(() => applySettings(parsed.data)));
  });

  server.post("/mappings", async (request, reply) => {
    const parsed = mappingsRequest.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid accounts" });
    return respond(reply, () => applyMappings(parsed.data));
  });

  server.post("/actions/discover", async (_request, reply) => {
    const accepted = queueDiscovery();
    const response: ActionResponse = accepted
      ? { accepted, message: "Refreshing accounts…" }
      : { accepted, message: "Accounts are already refreshing." };
    return reply.code(accepted ? 202 : 409).send(response);
  });
}
