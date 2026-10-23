import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { Cron } from "croner";
import { parse } from "yaml";
import { z } from "zod";

import { ConfigError } from "./errors.js";
import { loadSettings, type ActualCredentials } from "./settings-store.js";

export const connectionId = z.string().regex(/^[a-z][a-z0-9-]*$/);
export const httpUrl = z
  .url()
  .refine(
    (value) => ["http:", "https:"].includes(new URL(value).protocol),
    "must use HTTP or HTTPS",
  );

const actualSchema = z.object({
  cacheDirectory: z.string().default("/tmp/actual-cache"),
  serverUrl: httpUrl,
  syncId: z.string().min(1).optional(),
});

const connectionSchema = z.object({ id: connectionId });

const mappingSchema = z.object({
  actualAccountId: z.string().min(1),
  alias: z.string().min(1),
  connections: z.array(z.string().min(1)).min(1),
  upAccountId: z.string().uuid(),
});

const configSchema = z.object({
  version: z.literal(1),
  settingsFile: z.string().min(1).default("/data/settings.json"),
  actual: actualSchema,
  categoryMappings: z.record(z.string(), z.string()).default({}),
  mappings: z.array(mappingSchema).default([]),
  notes: z
    .object({
      includeCashback: z.boolean().default(true),
      includeForeignAmount: z.boolean().default(true),
      includeMessage: z.boolean().default(true),
      includePerformer: z.boolean().default(true),
      includeRoundUp: z.boolean().default(false),
    })
    .prefault({}),
  schedule: z
    .object({
      enabled: z.boolean().default(true),
      backfillCron: z.string().min(1).default("0 3 * * *"),
      cron: z.string().min(1).default("*/15 * * * *"),
      lookbackDays: z.number().int().min(1).max(365).default(30),
      timezone: z.string().min(1).default("Australia/Sydney"),
    })
    .prefault({}),
  server: z
    .object({
      host: z.string().default("0.0.0.0"),
      port: z.number().int().min(1).max(65_535).default(3000),
      publicUrl: httpUrl.optional(),
    })
    .prefault({}),
  up: z.object({ connections: z.array(connectionSchema) }),
});

/** Browser-managed credentials travel beside the YAML settings, never inside them. */
export type Secrets = { actual?: ActualCredentials; tokens: Record<string, string> };
export type AppConfig = z.infer<typeof configSchema> & { secrets: Secrets };
export type AccountMapping = AppConfig["mappings"][number];
export type UpConnectionConfig = AppConfig["up"]["connections"][number];

export function environmentValue(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new ConfigError(`Environment variable ${name} is required`);
  }
  return value;
}

export async function loadConfig(path: string): Promise<AppConfig> {
  const absolutePath = resolve(path);
  let parsed: unknown;
  try {
    parsed = parse(await readFile(absolutePath, "utf8"));
  } catch {
    throw new ConfigError(`Could not read YAML configuration ${absolutePath}`);
  }
  return loadSettings(parseConfig(parsed));
}

export function parseConfig(value: unknown): AppConfig {
  let config: AppConfig;
  try {
    config = { ...configSchema.parse(value), secrets: { tokens: {} } };
    const publicUrl = process.env.ACTUAL_UP_PUBLIC_URL;
    if (publicUrl !== undefined) config.server.publicUrl = httpUrl.parse(publicUrl);
  } catch (error) {
    if (error instanceof z.ZodError)
      throw new ConfigError(`Invalid configuration\n${z.prettifyError(error)}`);
    throw error;
  }
  validateConfig(config);
  return config;
}

function validateConfig(config: AppConfig): void {
  const connectionIds = new Set(config.up.connections.map(({ id }) => id));
  if (connectionIds.size !== config.up.connections.length) {
    throw new ConfigError("Up connection IDs must be unique");
  }

  const aliases = new Set<string>();
  const upAccountIds = new Set<string>();
  const actualAccountIds = new Set<string>();
  for (const mapping of config.mappings) {
    if (upAccountIds.has(mapping.upAccountId)) {
      throw new ConfigError(`Up account ${mapping.upAccountId} is mapped more than once`);
    }
    if (actualAccountIds.has(mapping.actualAccountId)) {
      throw new ConfigError(`Actual account ${mapping.actualAccountId} is mapped more than once`);
    }
    if (aliases.has(mapping.alias)) throw new ConfigError("Mapping aliases must be unique");
    aliases.add(mapping.alias);
    upAccountIds.add(mapping.upAccountId);
    actualAccountIds.add(mapping.actualAccountId);

    for (const id of mapping.connections) {
      if (!connectionIds.has(id)) {
        throw new ConfigError(`Mapping ${mapping.alias} references unknown connection ${id}`);
      }
    }
  }

  try {
    new Intl.DateTimeFormat("en-AU", { timeZone: config.schedule.timezone });
  } catch {
    throw new ConfigError(`Invalid timezone ${config.schedule.timezone}`);
  }

  for (const pattern of [config.schedule.cron, config.schedule.backfillCron]) {
    try {
      new Cron(pattern, { paused: true, timezone: config.schedule.timezone }).stop();
    } catch {
      throw new ConfigError(`Invalid schedule ${pattern}`);
    }
  }
}
