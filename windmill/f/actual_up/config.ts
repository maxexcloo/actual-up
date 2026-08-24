import * as wmill from "windmill-client@1.792.0";
import { z } from "zod@4.4.3";

import type { ActualUpConfig } from "./types";

export const CONFIG_PATH = "f/actual_up/config";

const connection = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  token: z.string().min(1),
  webhook: z
    .object({ id: z.string().uuid(), secret: z.string().min(1) })
    .optional(),
});

const mapping = z.object({
  actualAccountId: z.string().min(1),
  alias: z.string().min(1),
  connections: z.array(z.string().min(1)).min(1),
  upAccountId: z.string().uuid(),
});

const schema = z.object({
  actual: z.object({
    bridgeToken: z.string().min(1),
    bridgeUrl: z
      .url()
      .refine((value) => ["http:", "https:"].includes(new URL(value).protocol)),
  }),
  alerts: z.object({ url: z.url() }).optional(),
  categoryMappings: z.record(z.string(), z.string()).default({}),
  mappings: z.array(mapping).default([]),
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
      lookbackDays: z.number().int().min(1).max(365).default(30),
      timezone: z.string().min(1).default("Australia/Sydney"),
    })
    .default({ lookbackDays: 30, timezone: "Australia/Sydney" }),
  up: z.object({ connections: z.array(connection).min(1) }),
});

export async function loadConfig(): Promise<ActualUpConfig> {
  const config = schema.parse(await wmill.getResource(CONFIG_PATH));
  validateUniqueMappings(config);
  return config;
}

function validateUniqueMappings(config: ActualUpConfig): void {
  const connectionIds = new Set(config.up.connections.map(({ id }) => id));
  if (connectionIds.size !== config.up.connections.length)
    throw new Error("Up connection IDs must be unique");

  const aliases = new Set<string>();
  const upAccountIds = new Set<string>();
  const actualAccountIds = new Set<string>();
  for (const item of config.mappings) {
    if (aliases.has(item.alias))
      throw new Error(`Mapping alias ${item.alias} is duplicated`);
    if (upAccountIds.has(item.upAccountId))
      throw new Error(
        `Up account ${item.upAccountId} is mapped more than once`,
      );
    if (actualAccountIds.has(item.actualAccountId))
      throw new Error(
        `Actual account ${item.actualAccountId} is mapped more than once`,
      );
    for (const id of item.connections) {
      if (!connectionIds.has(id))
        throw new Error(
          `Mapping ${item.alias} references unknown connection ${id}`,
        );
    }
    aliases.add(item.alias);
    upAccountIds.add(item.upAccountId);
    actualAccountIds.add(item.actualAccountId);
  }
}
