import { mkdtemp, readFile, rm, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import pino from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppState } from "../src/api.js";
import { parseConfig } from "../src/config.js";
import { JobRunner } from "../src/job-runner.js";
import { LogBuffer } from "../src/logs.js";
import { Metrics } from "../src/metrics.js";
import { registerSettings } from "../src/settings.js";
import { connectionToken, loadSettings } from "../src/settings-store.js";
import * as settingsStore from "../src/settings-store.js";
import type { SyncEngine } from "../src/sync-engine.js";
import type { ActualClient, UpClientLike } from "../src/types.js";

const upId = "11111111-1111-4111-8111-111111111111";
const secondId = "22222222-2222-4222-8222-222222222222";
const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "actual-up-settings-"));
  cleanups.push(() => rm(directory, { force: true, recursive: true }));
  vi.stubEnv("ACTUAL_UP_ENCRYPTION_KEY", "k".repeat(40));
  const config = parseConfig({
    version: 1,
    settingsFile: join(directory, "settings.json"),
    actual: { serverUrl: "http://actual", syncId: "budget" },
    up: { connections: [{ id: "max" }] },
  });
  config.secrets.tokens.max = "test-secret-never-render";
  config.secrets.actual = { method: "session", credential: "actual-token-never-render" };
  const logger = pino({ enabled: false });
  const runner = new JobRunner(new Metrics(), logger);
  const upAccount = (id: string, displayName: string) => ({
    id,
    attributes: { displayName, balance: { value: "private-balance" } },
  });
  const client = {
    ping: vi.fn().mockResolvedValue(undefined),
    listAccounts: vi
      .fn()
      .mockResolvedValue([upAccount(upId, "<script>bad</script>"), upAccount(secondId, "Savings")]),
  };
  const clients = new Map<string, UpClientLike>([["max", client as unknown as UpClientLike]]);
  const actual = {
    open: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    sync: vi.fn().mockResolvedValue(undefined),
    getAccounts: vi.fn().mockResolvedValue([
      { id: "actual-id", name: "Spending" },
      { id: "actual-2", name: "Savings" },
    ]),
  };
  const engine = { reconcile: vi.fn().mockResolvedValue({ failed: 0, imported: 1 }) };
  const makeClient = vi.fn().mockReturnValue(client);
  const server = Fastify({ loggerInstance: logger });
  registerSettings(
    server,
    config,
    {
      actual: actual as unknown as ActualClient,
      clients,
      engine: engine as unknown as SyncEngine,
      logger,
      logs: new LogBuffer(),
      metrics: new Metrics(),
      runner,
    },
    makeClient,
  );
  cleanups.push(async () => {
    await runner.close();
    await server.close();
  });
  const state = async () => (await server.inject("/state")).json() as AppState;
  const saveSettings = async (body: Record<string, unknown> = {}) => {
    const { revisions } = await state();
    return server.inject({
      method: "POST",
      url: "/settings",
      payload: {
        revision: revisions.settings,
        actual: { serverUrl: "http://actual", syncId: "budget", method: "session" },
        connections: [{ id: "max" }],
        ...body,
      },
    });
  };
  const row = (overrides: Record<string, unknown> = {}) => ({
    upAccountId: upId,
    actualAccountId: "actual-id",
    alias: "spending",
    connections: ["max"],
    ...overrides,
  });
  const saveMappings = async (mappings: unknown[], drain = true) => {
    const { revisions } = await state();
    const response = await server.inject({
      method: "POST",
      url: "/mappings",
      payload: { revision: revisions.mappings, mappings },
    });
    if (drain) await runner.drain();
    return response;
  };
  // The first visit discovers accounts.
  await server.inject("/state");
  await runner.drain();
  return {
    actual,
    client,
    clients,
    config,
    engine,
    makeClient,
    row,
    runner,
    saveMappings,
    saveSettings,
    server,
    state,
  };
}

describe("browser setup", () => {
  it("lists discovered accounts without balances or keys and discovers on first visit", async () => {
    const f = await fixture();
    expect(f.client.listAccounts).toHaveBeenCalledOnce();
    const page = await f.server.inject("/state");
    const body = page.json() as AppState;
    expect(body.accounts.map(({ name }) => name)).toEqual(["<script>bad</script>", "Savings"]);
    expect(body.actualAccounts).toHaveLength(2);
    expect(page.body).not.toContain("private-balance");
    expect(page.body).not.toContain("never-render");
    const refresh = await f.server.inject({ method: "POST", url: "/actions/discover" });
    expect(refresh.statusCode).toBe(202);
    await f.runner.drain();
    expect(f.client.listAccounts).toHaveBeenCalledTimes(2);
  });

  it("persists mappings before backfill, ignores unsynced rows and restores them on restart", async () => {
    const f = await fixture();
    f.engine.reconcile.mockImplementation(async () => {
      expect((await loadSettings(f.config)).mappings).toHaveLength(1);
      return { failed: 0, imported: 1 };
    });
    const response = await f.saveMappings([
      f.row(),
      f.row({ upAccountId: secondId, actualAccountId: null, alias: "" }),
    ]);
    expect(response.statusCode).toBe(200);
    expect(response.json().message).toContain("backfill queued");
    expect(f.engine.reconcile).toHaveBeenCalledWith({
      since: "1970-01-01",
      progress: expect.any(Function),
      mappingAliases: ["spending"],
    });
    const restored = await loadSettings(parseConfig({ ...f.config, mappings: [] }));
    expect(restored.mappings.map(({ upAccountId }) => upAccountId)).toEqual([upId]);
    expect((await stat(f.config.settingsFile)).mode & 0o777).toBe(0o600);
    expect(await readFile(f.config.settingsFile, "utf8")).not.toContain("never-render");
  });

  it("rejects stale, invalid, duplicate and inaccessible mappings without changing them", async () => {
    const f = await fixture();
    const { revisions } = await f.state();
    await f.saveMappings([f.row()]);
    const stale = await f.server.inject({
      method: "POST",
      url: "/mappings",
      payload: { revision: revisions.mappings, mappings: [] },
    });
    expect(stale.statusCode).toBe(400);
    expect(stale.json().error).toContain("Reload");
    for (const mappings of [
      [f.row({ alias: "" })],
      [f.row(), f.row({ upAccountId: secondId })],
      [f.row({ actualAccountId: "actual-2" })],
      [f.row(), f.row({ upAccountId: secondId, actualAccountId: "missing", alias: "savings" })],
    ])
      expect((await f.saveMappings(mappings)).statusCode).toBe(400);
    expect(f.config.mappings).toEqual([
      { actualAccountId: "actual-id", alias: "spending", connections: ["max"], upAccountId: upId },
    ]);
    expect(f.engine.reconcile).toHaveBeenCalledOnce();
  });

  it("renames without upstream calls or another backfill, and honours paused automation", async () => {
    const f = await fixture();
    f.config.schedule.enabled = false;
    await f.saveMappings([f.row()]);
    f.client.listAccounts.mockClear();
    f.actual.getAccounts.mockClear();
    await f.saveMappings([f.row({ alias: "renamed" })]);
    expect(f.config.mappings[0]?.alias).toBe("renamed");
    expect(f.client.listAccounts).not.toHaveBeenCalled();
    expect(f.actual.getAccounts).not.toHaveBeenCalled();
    expect(f.engine.reconcile).not.toHaveBeenCalled();
  });

  it("saves accounts immediately while a sync is running", async () => {
    const f = await fixture();
    let release!: () => void;
    f.runner.enqueue("hold", "manual", () => new Promise<void>((resolve) => (release = resolve)));
    try {
      expect((await f.saveMappings([f.row()], false)).statusCode).toBe(200);
      expect(f.config.mappings).toHaveLength(1);
    } finally {
      release();
    }
    await f.runner.drain();
  });

  it.each(["mappings", "settings"])(
    "rejects overlapping %s saves while accounts are being persisted",
    async (form) => {
      const f = await fixture();
      let signalStarted!: () => void;
      let release!: () => void;
      const started = new Promise<void>((resolve) => (signalStarted = resolve));
      const gate = new Promise<void>((resolve) => (release = resolve));
      const persist = settingsStore.saveSettings;
      vi.spyOn(settingsStore, "saveSettings").mockImplementationOnce(async (config) => {
        signalStarted();
        await gate;
        await persist(config);
      });
      const saving = f.saveMappings([f.row()], false);
      await started;
      try {
        const response =
          form === "mappings"
            ? await f.saveMappings([], false)
            : await f.saveSettings({ connections: [] });
        expect(response.statusCode).toBe(400);
        expect(response.json().error).toContain("already being saved");
      } finally {
        release();
        await saving;
      }
      expect((await loadSettings(f.config)).mappings).toEqual([f.row()]);
      expect(f.config.up.connections).toEqual([{ id: "max" }]);
      expect((await f.saveMappings([], false)).statusCode).toBe(200);
      expect((await loadSettings(f.config)).mappings).toEqual([]);
    },
  );

  it("rejects account saves while switching Actual budgets", async () => {
    const f = await fixture();
    let signalStarted!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => (signalStarted = resolve));
    const gate = new Promise<void>((resolve) => (release = resolve));
    f.actual.open.mockImplementationOnce(async () => {
      signalStarted();
      await gate;
    });
    const saving = f.saveSettings({
      actual: { serverUrl: "http://actual", syncId: "new-budget", method: "session" },
    });
    await started;
    try {
      const response = await f.saveMappings([f.row()], false);
      expect(response.statusCode).toBe(400);
      expect(response.json().error).toContain("already being saved");
    } finally {
      release();
      await saving;
    }
    const restored = await loadSettings(f.config);
    expect(restored.actual.syncId).toBe("new-budget");
    expect(restored.mappings).toEqual([]);
  });

  it("checks new keys, encrypts them and rejects invalid keys or removing keys in use", async () => {
    const f = await fixture();
    const added = await f.saveSettings({
      connections: [{ id: "max" }, { id: "partner", token: "partner-secret" }],
    });
    expect(added.json()).toEqual({ accepted: true, message: "Settings saved." });
    expect(f.makeClient).toHaveBeenCalledWith("partner-secret", "partner");
    expect(f.clients.has("partner")).toBe(true);
    expect(f.actual.open).not.toHaveBeenCalled();
    expect(await readFile(f.config.settingsFile, "utf8")).not.toContain("partner-secret");
    const restored = await loadSettings(f.config);
    expect(connectionToken(restored, { id: "partner" })).toBe("partner-secret");
    expect((await f.state()).accounts[0]?.connections).toEqual(["max", "partner"]);

    f.client.ping.mockRejectedValueOnce(new Error("bad-key-secret"));
    const bad = await f.saveSettings({
      connections: [{ id: "max" }, { id: "bad", token: "bad-key-secret" }],
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.body).not.toContain("bad-key-secret");
    expect(f.clients.has("bad")).toBe(false);
    expect((await f.saveSettings({ connections: [{ id: "new" }] })).statusCode).toBe(400);

    await f.saveMappings([f.row()]);
    const inUse = await f.saveSettings({ connections: [{ id: "partner" }] });
    expect(inUse.json().error).toContain("Disconnect spending");
    expect(f.config.up.connections.map(({ id }) => id)).toEqual(["max", "partner"]);
    await f.saveSettings({ connections: [{ id: "max" }] });
    expect(f.clients.has("partner")).toBe(false);
  });

  it("keeps one shared mapping that falls back across keys", async () => {
    const f = await fixture();
    await f.saveSettings({ connections: [{ id: "max" }, { id: "partner", token: "another" }] });
    await f.saveMappings([f.row({ connections: ["max", "partner"] })]);
    const page = await f.state();
    expect(page.accounts[0]).toMatchObject({
      connections: ["max", "partner"],
      mapping: { alias: "spending", connections: ["max", "partner"] },
    });
    expect(f.config.mappings).toHaveLength(1);
  });

  it("saves Actual credentials encrypted, keeps blank ones and rolls back a failed connection", async () => {
    const f = await fixture();
    const actual = {
      serverUrl: "http://new-actual",
      syncId: "new-budget",
      method: "session",
      credential: "actual-secret-token",
    };
    expect((await f.saveSettings({ actual })).statusCode).toBe(200);
    expect(f.actual.open).toHaveBeenCalledOnce();
    expect(f.config.actual.serverUrl).toBe("http://new-actual");
    expect((await loadSettings(f.config)).secrets.actual?.credential).toBe("actual-secret-token");
    expect(await readFile(f.config.settingsFile, "utf8")).not.toContain("actual-secret-token");
    const page = await f.server.inject("/state");
    expect(page.json().actual).toMatchObject({ configured: true, method: "session" });
    expect(page.body).not.toContain("actual-secret-token");

    await f.saveSettings({ actual: { ...actual, credential: "" } });
    expect(f.config.secrets.actual?.credential).toBe("actual-secret-token");
    f.actual.open.mockRejectedValueOnce(new Error("upstream contains secret"));
    const failed = await f.saveSettings({ actual: { ...actual, credential: "replacement" } });
    expect(failed.statusCode).toBe(400);
    expect(failed.body).not.toContain("upstream contains secret");
    expect(f.config.secrets.actual?.credential).toBe("actual-secret-token");
    expect((await loadSettings(f.config)).secrets.actual?.credential).toBe("actual-secret-token");

    await f.saveMappings([f.row()]);
    expect((await f.saveSettings({ actual: { ...actual, syncId: "other" } })).statusCode).toBe(400);
    expect(f.config.actual.syncId).toBe("new-budget");
  });

  it("keeps live settings when storage fails", async () => {
    const f = await fixture();
    await writeFile(f.config.settingsFile, "not a directory");
    f.config.settingsFile += "/settings.json";
    expect((await f.saveMappings([f.row()])).statusCode).toBe(500);
    expect(f.config.mappings).toEqual([]);
    expect(f.engine.reconcile).not.toHaveBeenCalled();
    f.config.settingsFile = join(f.config.settingsFile, "..", "..", "recovered.json");
    expect((await f.saveMappings([f.row()])).statusCode).toBe(200);
  });

  it("fails closed on corrupt persisted settings", async () => {
    const f = await fixture();
    await f.saveMappings([f.row()]);
    vi.stubEnv("ACTUAL_UP_ENCRYPTION_KEY", "w".repeat(40));
    await expect(loadSettings(f.config)).rejects.toThrow();
    vi.stubEnv("ACTUAL_UP_ENCRYPTION_KEY", "k".repeat(40));
    const envelope = JSON.parse(await readFile(f.config.settingsFile, "utf8"));
    const data = Buffer.from(envelope.data, "base64");
    data[0] = data[0]! ^ 1;
    envelope.data = data.toString("base64");
    await writeFile(f.config.settingsFile, JSON.stringify(envelope));
    await expect(loadSettings(f.config)).rejects.toThrow();
    await writeFile(f.config.settingsFile, "broken");
    await expect(loadSettings(f.config)).rejects.toThrow();
  });
});
