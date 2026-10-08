import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import {
  environmentValue,
  parseConfig,
  type AppConfig,
  type UpConnectionConfig,
} from "./config.js";

const credentials = new WeakMap<AppConfig, Record<string, string>>();
const actualSecrets = new WeakMap<AppConfig, ActualCredentials>();
const actualCredentialsSchema = z
  .object({
    method: z.enum(["session", "password"]),
    credential: z.string().min(1),
    encryptionPassword: z.string().optional(),
  })
  .strict();
export type ActualCredentials = z.infer<typeof actualCredentialsSchema>;

export function getActualCredentials(
  config: AppConfig,
): ActualCredentials | undefined {
  const saved = actualSecrets.get(config);
  if (saved) return saved;
  const name = config.actual.sessionTokenEnv ?? config.actual.passwordEnv;
  if (!name || !process.env[name]) return undefined;
  return {
    method: config.actual.sessionTokenEnv ? "session" : "password",
    credential: environmentValue(name),
    encryptionPassword: config.actual.encryptionPasswordEnv
      ? environmentValue(config.actual.encryptionPasswordEnv)
      : undefined,
  };
}

export function setActualCredentials(
  config: AppConfig,
  value: ActualCredentials,
): void {
  actualSecrets.set(config, value);
}

const context = Buffer.from("actual-up/settings/v1");
const envelopeSchema = z
  .object({
    version: z.literal(1),
    iv: z.string(),
    tag: z.string(),
    data: z.string(),
  })
  .strict();
const storedSchema = z
  .object({
    actual: z.unknown(),
    actualCredentials: actualCredentialsSchema.optional(),
    connections: z.array(z.unknown()),
    mappings: z.array(z.unknown()),
    tokens: z.record(z.string(), z.string()),
  })
  .strict();

function settings(config: AppConfig) {
  return {
    actual: config.actual,
    actualCredentials: actualSecrets.get(config),
    connections: config.up.connections,
    mappings: config.mappings,
    tokens: credentials.get(config) ?? {},
  };
}

function encryptionKey(config: AppConfig): Buffer {
  const secret = environmentValue(config.encryptionKeyEnv);
  if (secret.length < 32)
    throw new Error("Encryption key must contain at least 32 characters");
  return createHash("sha256").update(secret).digest();
}

export function checkEncryptionKey(config: AppConfig): void {
  encryptionKey(config);
}

export function copyCredentials(source: AppConfig, target: AppConfig): void {
  credentials.set(target, { ...credentials.get(source) });
  const actual = actualSecrets.get(source);
  if (actual) actualSecrets.set(target, { ...actual });
  else actualSecrets.delete(target);
}

export function setConnectionToken(
  config: AppConfig,
  id: string,
  token?: string,
): void {
  const tokens = { ...credentials.get(config) };
  if (token === undefined) delete tokens[id];
  else tokens[id] = token;
  credentials.set(config, tokens);
}

export function connectionToken(
  config: AppConfig,
  connection: UpConnectionConfig,
): string {
  const saved = credentials.get(config)?.[connection.id];
  if (saved) return saved;
  if (connection.tokenEnv) return environmentValue(connection.tokenEnv);
  throw new Error("Connection has no saved API key");
}

export function settingsVersion(config: AppConfig): string {
  return createHash("sha256")
    .update(JSON.stringify(settings(config)))
    .digest("hex");
}

export async function loadSettings(config: AppConfig): Promise<AppConfig> {
  let source: string;
  try {
    source = await readFile(config.settingsFile, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return config;
    throw error;
  }
  const envelope = envelopeSchema.parse(JSON.parse(source));
  const iv = Buffer.from(envelope.iv, "base64");
  const tag = Buffer.from(envelope.tag, "base64");
  if (iv.length !== 12 || tag.length !== 16)
    throw new Error("Invalid encrypted settings");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(config), iv);
  decipher.setAAD(context);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.data, "base64")),
    decipher.final(),
  ]);
  const saved = storedSchema.parse(JSON.parse(plaintext.toString("utf8")));
  const loaded = parseConfig({
    ...config,
    actual: saved.actual,
    up: { connections: saved.connections },
    mappings: saved.mappings,
  });
  loaded.actual.cacheDirectory = config.actual.cacheDirectory;
  credentials.set(loaded, saved.tokens);
  if (saved.actualCredentials)
    actualSecrets.set(loaded, saved.actualCredentials);
  for (const connection of loaded.up.connections)
    connectionToken(loaded, connection);
  return loaded;
}

/** Encrypt all settings and keys together; atomically commit before changing live state. */
export async function saveSettings(config: AppConfig): Promise<void> {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(config), iv);
  cipher.setAAD(context);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(settings(config)), "utf8"),
    cipher.final(),
  ]);
  const envelope = {
    version: 1,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: encrypted.toString("base64"),
  };
  const directory = dirname(config.settingsFile);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = `${config.settingsFile}.${randomUUID()}.tmp`;
  try {
    const file = await open(temporary, "wx", 0o600);
    try {
      await file.writeFile(`${JSON.stringify(envelope)}\n`);
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, config.settingsFile);
  } finally {
    await rm(temporary, { force: true });
  }
}
