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

export const actualForm = z.object({
  serverUrl: httpUrl,
  syncId: z.string().trim().min(1, "Enter the budget sync ID"),
  method: z.enum(["session", "password"]),
  credential: z.string().max(8192).default(""),
  encryptionPassword: z.string().max(8192).default(""),
  clearEncryption: z.boolean().default(false),
});

export const connectionForm = z.object({
  id: connectionId.max(80),
  token: z.string().trim().min(1, "Enter an Up API key").max(8192),
});

export const mappingForm = z.object({
  alias: z.string().trim().min(1, "Enter an account name").max(80),
  actualAccountId: z.string().min(1, "Choose an Actual account"),
  connections: z.array(z.string()).min(1, "Choose at least one connection"),
});

export const syncForm = z
  .object({
    mode: z.enum(["dry-run", "live"]),
    account: z.string().default(""),
    connection: z.string().default(""),
    since: z.string().default(""),
  })
  .strict();

export const testForm = z
  .object({
    target: z.enum(["actual", "up"]),
    connection: z.string().default(""),
  })
  .strict();

const revision = { revision: z.string() };
const account = { upAccountId: z.uuid() };

export const settingsCommand = z.discriminatedUnion("action", [
  actualForm.extend({ ...revision, action: z.literal("actual") }).strict(),
  z.object({ ...revision, action: z.literal("discover") }).strict(),
  connectionForm.extend({ ...revision, action: z.literal("connection") }).strict(),
  z.object({ ...revision, action: z.literal("remove-connection"), id: z.string() }).strict(),
  mappingForm.extend({ ...revision, ...account, action: z.literal("mapping") }).strict(),
  z.object({ ...revision, ...account, action: z.literal("remove-mapping") }).strict(),
]);
export type SettingsCommand = z.input<typeof settingsCommand>;
