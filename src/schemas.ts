import { z } from "zod";

// Shared by the server and the browser, so this module may only import zod.

/** Backfills from this date read an account's full Up history. */
export const HISTORY_START = "1970-01-01";

export const connectionId = z
  .string()
  .regex(/^[a-z][a-z0-9-]*$/, "Use lowercase letters, numbers and hyphens, starting with a letter");
export const httpUrl = z
  .url("Enter a full URL")
  .refine(
    (value) => ["http:", "https:"].includes(new URL(value).protocol),
    "must use HTTP or HTTPS",
  );

export const loginForm = z
  .object({
    username: z.string().min(1, "Enter your username").max(256),
    password: z.string().min(1, "Enter your password").max(8192),
  })
  .strict();

export const settingsForm = z
  .object({
    actual: z
      .object({
        serverUrl: httpUrl,
        syncId: z.string().trim().min(1, "Enter the budget sync ID"),
        method: z.enum(["session", "password"]),
        credential: z.string().max(8192).default(""),
        encryptionPassword: z.string().max(8192).default(""),
        clearEncryption: z.boolean().default(false),
      })
      .strict(),
    /** A blank token keeps the saved key; a missing connection removes it. */
    connections: z.array(
      z
        .object({
          id: connectionId.max(80),
          token: z.string().trim().max(8192).default(""),
        })
        .strict(),
    ),
  })
  .strict();

export const mappingsForm = z
  .object({
    /** Every listed Up account; a row without an Actual account is not synced. */
    mappings: z.array(
      z
        .object({
          upAccountId: z.uuid(),
          actualAccountId: z.string().min(1).nullable(),
          alias: z.string().trim().max(80),
          connections: z.array(z.string()),
        })
        .strict()
        .superRefine((row, context) => {
          if (!row.actualAccountId) return;
          if (!row.alias)
            context.addIssue({ code: "custom", message: "Enter an account name", path: ["alias"] });
          if (!row.connections.length)
            context.addIssue({
              code: "custom",
              message: "Choose at least one key",
              path: ["connections"],
            });
        }),
    ),
  })
  .strict();

const revision = { revision: z.string() };
export const settingsRequest = settingsForm.extend(revision).strict();
export const mappingsRequest = mappingsForm.extend(revision).strict();

export const syncForm = z
  .object({
    mode: z.enum(["dry-run", "live"]),
    account: z.string().default(""),
    since: z
      .union([
        z.literal(""),
        z.iso
          .date("Choose a valid date in the past")
          .refine(
            (value) => value <= new Date().toISOString().slice(0, 10),
            "Choose a valid date in the past",
          ),
      ])
      .default(""),
  })
  .strict();
