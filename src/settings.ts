import type { FastifyInstance } from "fastify";
import type { Server, IncomingMessage, ServerResponse } from "node:http";
import type { Logger } from "pino";
import { z } from "zod";
import { environmentValue, parseConfig, type AppConfig } from "./config.js";
import type { JobRunner } from "./job-runner.js";
import { assertActualCompatibility, type Runtime } from "./runtime.js";
import {
  saveSettings,
  settingsVersion,
  copyCredentials,
  getActualCredentials,
  setActualCredentials,
  setConnectionToken,
} from "./settings-store.js";
import {
  accountSettingsRow,
  settingsPage,
  type AccountUpdate,
  type Discovery,
} from "./settings-ui.js";
import type { SyncEngine } from "./sync-engine.js";
import { UpClient } from "./up-client.js";
import type { UpClientLike } from "./types.js";

class SettingsError extends Error {}

const fields = { revision: z.string() };
const commandSchema = z.discriminatedUnion("action", [
  z
    .object({
      ...fields,
      action: z.literal("actual"),
      serverUrl: z
        .url()
        .refine((value) =>
          ["http:", "https:"].includes(new URL(value).protocol),
        ),
      syncId: z.string().trim().min(1),
      method: z.enum(["session", "password"]),
      credential: z.string().max(8192).default(""),
      encryptionPassword: z.string().max(8192).default(""),
      clearEncryption: z.literal("true").optional(),
    })
    .strict(),
  z.object({ ...fields, action: z.literal("discover") }).strict(),
  z
    .object({
      ...fields,
      action: z.literal("connection"),
      id: z
        .string()
        .regex(/^[a-z][a-z0-9-]*$/)
        .max(80),
      token: z.string().trim().min(1).max(8192),
    })
    .strict(),
  z
    .object({
      ...fields,
      action: z.literal("remove-connection"),
      id: z.string(),
    })
    .strict(),
  z
    .object({
      ...fields,
      action: z.literal("mapping"),
      alias: z.string().trim().min(1).max(80),
      upAccountId: z.string().uuid(),
      viewConnection: z
        .string()
        .regex(/^[a-z][a-z0-9-]*$/)
        .optional(),
      actualAccountId: z.string().min(1),
      connections: z
        .union([z.string(), z.array(z.string())])
        .transform((value) => (typeof value === "string" ? [value] : value)),
    })
    .strict(),
  z
    .object({
      ...fields,
      action: z.literal("remove-mapping"),
      upAccountId: z.string().uuid(),
      viewConnection: z
        .string()
        .regex(/^[a-z][a-z0-9-]*$/)
        .optional(),
    })
    .strict(),
]);

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
  const accountRow = (
    id: string,
    update = accountUpdates.get(id),
    viewConnection?: string,
  ) => {
    const mapping = config.mappings.find(
      ({ upAccountId }) => upAccountId === id,
    );
    const account = discovery?.up.find((account) => account.id === id) ?? {
      connections: mapping?.connections ?? [],
      id,
      name: mapping?.alias ?? "Account",
    };
    const primary = viewConnection ?? account.connections[0] ?? "";
    const others = account.connections.filter(
      (connection) => connection !== primary,
    );
    return (
      accountSettingsRow(config, discovery, account, update, primary) +
      others
        .map((connection) =>
          accountSettingsRow(
            config,
            discovery,
            account,
            update,
            connection,
          ).replace(
            '<div class="account-row',
            '<div hx-swap-oob="outerHTML" class="account-row',
          ),
        )
        .join("")
    );
  };
  server.get<{ Params: { id: string }; Querystring: { connection?: string } }>(
    "/accounts/:id",
    async (request, reply) => {
      const update = accountUpdates.get(request.params.id);
      if (!update) return reply.code(404).send("Unknown account update");
      if (update.pending) return reply.code(204).send();
      return reply
        .type("text/html")
        .send(accountRow(request.params.id, update, request.query.connection));
    },
  );

  const discover = async (): Promise<Discovery> => {
    discoveryAttempted = true;
    let actual: Discovery["actual"] = [];
    let actualUnavailable = false;
    try {
      await runtime.actual.sync();
      actual = (await runtime.actual.getAccounts()).map(({ id, name }) => ({
        id,
        name,
      }));
    } catch {
      actualUnavailable = true;
    }
    const accounts = new Map<string, Discovery["up"][number]>();
    const unavailable: string[] = [];
    for (const [connection, client] of runtime.clients) {
      try {
        for (const { id, attributes } of await client.listAccounts()) {
          const account = accounts.get(id) ?? {
            id,
            name: attributes.displayName,
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

  server.get("/settings", async (_request, reply) => reply.redirect("/", 303));
  server.get<{ Querystring: { pending?: string } }>(
    "/",
    async (request, reply) => {
      if (request.query.pending === "1" && busy) return reply.code(204).send();
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
      return reply
        .type("text/html")
        .send(
          settingsPage(
            config,
            discovery,
            busy,
            message,
            runner,
            accountUpdates,
          ),
        );
    },
  );
  server.post("/settings", async (request, reply) => {
    const parsed = commandSchema.safeParse(request.body);
    const accountId =
      parsed.success && "upAccountId" in parsed.data
        ? parsed.data.upAccountId
        : undefined;
    const viewConnection =
      parsed.success && "viewConnection" in parsed.data
        ? parsed.data.viewConnection
        : undefined;
    const revision = () => settingsVersion(config, accountId);
    const reject = (code: number, explanation: string) =>
      reply
        .code(code)
        .type("text/html")
        .send(
          accountId && request.headers["hx-request"] === "true"
            ? accountRow(
                accountId,
                {
                  failed: true,
                  message: explanation,
                  pending: false,
                },
                viewConnection,
              )
            : settingsPage(
                config,
                discovery,
                busy,
                explanation,
                runner,
                accountUpdates,
              ),
        );
    if (!parsed.success)
      return reject(
        400,
        "Invalid settings. Reload the setup page and try again.",
      );
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
          copyCredentials(config, next);
          if (command.action === "actual") {
            const oldSyncId =
              config.actual.syncId ??
              (config.actual.syncIdEnv
                ? environmentValue(config.actual.syncIdEnv)
                : undefined);
            if (
              config.mappings.length &&
              (command.syncId !== oldSyncId ||
                command.serverUrl !== config.actual.serverUrl)
            )
              throw new SettingsError(
                "Disconnect account mappings before switching Actual servers or budgets. Existing transactions remain in the previous budget.",
              );
            const previousCredentials = getActualCredentials(config);
            const credential =
              command.credential ||
              (previousCredentials?.method === command.method
                ? previousCredentials.credential
                : "");
            if (!credential)
              throw new SettingsError(
                "Enter the Actual session token or password.",
              );
            next.actual = {
              cacheDirectory: config.actual.cacheDirectory,
              serverUrl: command.serverUrl,
              syncId: command.syncId,
            };
            setActualCredentials(next, {
              credential,
              method: command.method,
              encryptionPassword: command.clearEncryption
                ? undefined
                : command.encryptionPassword ||
                  previousCredentials?.encryptionPassword,
            });
            const previous = parseConfig(config);
            copyCredentials(config, previous);
            await runtime.actual.close();
            config.actual = next.actual;
            copyCredentials(next, config);
            try {
              await runtime.actual.open();
              assertActualCompatibility(
                await runtime.actual.getServerVersion(),
              );
              await saveSettings(next);
            } catch {
              await runtime.actual.close();
              config.actual = previous.actual;
              copyCredentials(previous, config);
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
              const accessible = new Set(
                (await newClient.listAccounts()).map(({ id }) => id),
              );
              if (
                assigned.some(({ upAccountId }) => !accessible.has(upAccountId))
              )
                throw new SettingsError(
                  "This key cannot access all its mapped accounts. Update those mappings before replacing the key.",
                );
            }
            const existing = next.up.connections.find(
              ({ id }) => id === command.id,
            );
            if (existing) delete existing.tokenEnv;
            else next.up.connections.push({ id: command.id });
            setConnectionToken(next, command.id, command.token);
          } else if (command.action === "remove-connection") {
            if (
              next.mappings.some(({ connections }) =>
                connections.includes(command.id),
              )
            )
              throw new SettingsError(
                "This key is still in use. Update or disconnect its mappings first.",
              );
            setConnectionToken(next, command.id);
            next.up.connections = next.up.connections.filter(
              ({ id }) => id !== command.id,
            );
          } else if (command.action === "mapping") {
            discovery = await discover();
            const account = discovery.up.find(
              ({ id }) => id === command.upAccountId,
            );
            if (
              !account ||
              !command.connections.length ||
              new Set(command.connections).size !==
                command.connections.length ||
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
              !command.connections.some((id) =>
                account.connections.includes(id),
              ) ||
              !discovery.actual.some(({ id }) => id === command.actualAccountId)
            )
              throw new SettingsError(
                "The selected keys cannot access these accounts. Refresh accounts and choose an available key and destination.",
              );
            const existing = next.mappings.find(
              ({ upAccountId }) => upAccountId === command.upAccountId,
            );
            if (
              existing &&
              existing.actualAccountId !== command.actualAccountId
            )
              throw new SettingsError(
                "Disconnect the mapping before changing its Actual destination. Existing transactions will remain in the old account.",
              );
            const mapping = {
              actualAccountId: command.actualAccountId,
              alias: command.alias,
              connections: command.connections,
              upAccountId: command.upAccountId,
            };
            next.mappings = [
              ...next.mappings.filter(
                ({ upAccountId }) => upAccountId !== command.upAccountId,
              ),
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
          await saveSettings(next);
          config.up = next.up;
          config.mappings = next.mappings;
          copyCredentials(next, config);
          saved = true;
          if (command.action === "connection" && newClient)
            runtime.clients.set(command.id, newClient);
          if (command.action === "remove-connection")
            runtime.clients.delete(command.id);
          if (!accountId) discovery = await discover();
          operationMessage = "Settings saved.";
          if (command.action === "mapping" && config.schedule.enabled) {
            const queued = runner.enqueue(
              `backfill:${command.upAccountId}`,
              "automatic-backfill",
              async () => {
                const mapping = config.mappings.find(
                  ({ upAccountId }) => upAccountId === command.upAccountId,
                );
                if (!mapping) return { ok: true };
                await runtime.actual.sync();
                return engine.reconcile({
                  since: "1970-01-01",
                  mappingAliases: [mapping.alias],
                });
              },
            );
            operationMessage = queued
              ? "Saved. History backfill queued; you can continue with other accounts."
              : "Saved. Automatic sync will backfill this account.";
          }
          return { ok: true };
        } catch (error) {
          failed = true;
          operationMessage =
            error instanceof SettingsError
              ? error.message
              : saved
                ? "Settings saved. Backfill could not complete; automatic sync will retry."
                : "Setup could not complete. Check the API key, Actual connection and writable storage, then retry.";
          throw new Error("Account setup failed");
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
    if (accountId && request.headers["hx-request"] === "true")
      return reply
        .header("HX-Trigger", "refresh-status")
        .type("text/html")
        .send(
          accountRow(accountId, accountUpdates.get(accountId), viewConnection),
        );
    return reply.redirect("/", 303);
  });
}
