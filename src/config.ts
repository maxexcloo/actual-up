import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { parse } from "yaml";
import { z } from "zod";

const environmentName = z
  .string()
  .regex(/^[A-Z][A-Z0-9_]*$/, "must be an environment variable name");
const httpUrl = z
  .url()
  .refine(
    (value) => ["http:", "https:"].includes(new URL(value).protocol),
    "must use HTTP or HTTPS",
  );

const actualSchema = z
  .object({
    cacheDirectory: z.string().default("/data/actual-cache"),
    encryptionPasswordEnv: environmentName.optional(),
    passwordEnv: environmentName.optional(),
    serverUrl: httpUrl,
    sessionTokenEnv: environmentName.optional(),
    syncId: z.string().min(1),
  })
  .refine(
    ({ passwordEnv, sessionTokenEnv }) =>
      Boolean(passwordEnv) !== Boolean(sessionTokenEnv),
    "set exactly one of passwordEnv or sessionTokenEnv",
  );

const connectionSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  tokenEnv: environmentName,
  webhook: z
    .object({
      id: z.string().uuid(),
      secretEnv: environmentName,
    })
    .optional(),
});

const mappingSchema = z.object({
  actualAccountId: z.string().min(1),
  alias: z.string().min(1),
  connections: z.array(z.string().min(1)).min(1),
  upAccountId: z.string().uuid(),
});

const configSchema = z.object({
  version: z.literal(1),
  actual: actualSchema,
  alerts: z
    .object({
      cooldownMinutes: z.number().int().min(0).default(60),
      urlEnv: environmentName,
    })
    .optional(),
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
    .default({
      includeCashback: true,
      includeForeignAmount: true,
      includeMessage: true,
      includePerformer: true,
      includeRoundUp: false,
    }),
  schedule: z
    .object({
      cron: z.string().min(1).default("*/15 * * * *"),
      lookbackDays: z.number().int().min(1).max(365).default(30),
      timezone: z.string().min(1).default("Australia/Sydney"),
    })
    .default({
      cron: "*/15 * * * *",
      lookbackDays: 30,
      timezone: "Australia/Sydney",
    }),
  server: z
    .object({
      host: z.string().default("0.0.0.0"),
      port: z.number().int().min(1).max(65_535).default(3000),
      publicUrl: httpUrl.optional(),
    })
    .default({ host: "0.0.0.0", port: 3000 }),
  up: z.object({ connections: z.array(connectionSchema).min(1) }),
});

export type AppConfig = z.infer<typeof configSchema>;
export type AccountMapping = AppConfig["mappings"][number];
export type UpConnectionConfig = AppConfig["up"]["connections"][number];

export function environmentValue(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Environment variable ${name} is required`);
  }
  return value;
}

export async function loadConfig(path: string): Promise<AppConfig> {
  const absolutePath = resolve(path);
  const source = await readFile(absolutePath, "utf8");
  const parsed: unknown = parse(source);
  const config = configSchema.parse(parsed);
  validateConfig(config);
  return config;
}

export function parseConfig(value: unknown): AppConfig {
  const config = configSchema.parse(value);
  validateConfig(config);
  return config;
}

function validateConfig(config: AppConfig): void {
  const connectionIds = new Set(config.up.connections.map(({ id }) => id));
  if (connectionIds.size !== config.up.connections.length) {
    throw new Error("Up connection IDs must be unique");
  }

  const upAccountIds = new Set<string>();
  const actualAccountIds = new Set<string>();
  for (const mapping of config.mappings) {
    if (upAccountIds.has(mapping.upAccountId)) {
      throw new Error(
        `Up account ${mapping.upAccountId} is mapped more than once`,
      );
    }
    if (actualAccountIds.has(mapping.actualAccountId)) {
      throw new Error(
        `Actual account ${mapping.actualAccountId} is mapped more than once`,
      );
    }
    upAccountIds.add(mapping.upAccountId);
    actualAccountIds.add(mapping.actualAccountId);

    for (const id of mapping.connections) {
      if (!connectionIds.has(id)) {
        throw new Error(
          `Mapping ${mapping.alias} references unknown connection ${id}`,
        );
      }
    }
  }

  try {
    new Intl.DateTimeFormat("en-AU", { timeZone: config.schedule.timezone });
  } catch {
    throw new Error(`Invalid timezone ${config.schedule.timezone}`);
  }
}
