import { mkdtemp, readFile, rm, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import pino from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseConfig } from "../src/config.js";
import { JobRunner } from "../src/job-runner.js";
import { Metrics } from "../src/metrics.js";
import { registerSettings } from "../src/settings.js";
import {
  connectionToken,
  getActualCredentials,
  loadSettings,
  settingsVersion,
} from "../src/settings-store.js";
import type { SyncEngine } from "../src/sync-engine.js";
import type { ActualClient, UpClientLike } from "../src/types.js";

const upId = "11111111-1111-4111-8111-111111111111";
const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.unstubAllEnvs();
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "actual-up-settings-"));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  vi.stubEnv(
    "ACTUAL_UP_ENCRYPTION_KEY",
    "test-encryption-key-at-least-32-characters",
  );
  vi.stubEnv("UP_TOKEN_MAX", "test-secret-never-render");
  vi.stubEnv("UP_TOKEN_PARTNER", "another-secret");
  const config = parseConfig({
    version: 1,
    settingsFile: join(directory, "settings.json"),
    actual: {
      serverUrl: "http://actual",
      syncId: "budget",
      passwordEnv: "ACTUAL_PASSWORD",
    },
    up: { connections: [{ id: "max", tokenEnv: "UP_TOKEN_MAX" }] },
  });
  const logger = pino({ enabled: false });
  const runner = new JobRunner(new Metrics(), logger);
  const accounts = [
    {
      id: upId,
      attributes: {
        displayName: "<script>bad</script>",
        balance: { value: "private-balance" },
      },
    },
  ];
  const client = {
    ping: vi.fn().mockResolvedValue(undefined),
    listAccounts: vi.fn().mockResolvedValue(accounts),
  };
  const clients = new Map<string, UpClientLike>([
    ["max", client as unknown as UpClientLike],
  ]);
  const actual = {
    open: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    getServerVersion: vi.fn().mockResolvedValue("26.10.0"),
    sync: vi.fn().mockResolvedValue(undefined),
    getAccounts: vi
      .fn()
      .mockResolvedValue([{ id: "actual-id", name: "Spending" }]),
  };
  const engine = {
    reconcile: vi.fn().mockResolvedValue({ failed: 0, imported: 1 }),
  };
  const makeClient = vi.fn().mockReturnValue(client);
  const server = Fastify({ loggerInstance: logger });
  registerSettings(
    server,
    config,
    runner,
    engine as unknown as SyncEngine,
    { actual: actual as unknown as ActualClient, clients },
    logger,
    makeClient,
  );
  cleanups.push(async () => {
    await runner.close();
    await server.close();
  });
  const post = async (data: Record<string, unknown>, drain = true) => {
    const result = await server.inject({
      method: "POST",
      url: "/settings",
      payload: { revision: settingsVersion(config), ...data },
    });
    if (drain) await runner.drain();
    return result;
  };
  const mapping = {
    action: "mapping",
    alias: "spending",
    upAccountId: upId,
    actualAccountId: "actual-id",
    connections: ["max"],
  };
  return {
    config,
    runner,
    actual,
    engine,
    client,
    clients,
    makeClient,
    server,
    post,
    mapping,
  };
}

describe("browser setup", () => {
  it("discovers accounts without balances, escapes names and never exposes keys", async () => {
    const f = await fixture();
    await f.post({ action: "discover" });
    const page = await f.server.inject("/");
    expect(page.body).toContain("&lt;script&gt;");
    expect(page.body).not.toContain("<script>bad");
    expect(page.body).not.toContain("private-balance");
    expect(page.body).not.toContain("test-secret-never-render");
  });

  it("discovers automatically on first visit and after adding a connection", async () => {
    const f = await fixture();
    await f.server.inject("/");
    await f.runner.drain();
    expect(f.client.listAccounts).toHaveBeenCalledOnce();
    const page = await f.server.inject("/");
    expect(page.body).toContain('data-connection="max"');
    expect(page.body).toContain(
      'data-account="11111111-1111-4111-8111-111111111111"',
    );
    await f.post({
      action: "connection",
      id: "partner",
      token: "partner-secret",
    });
    const updated = await f.server.inject("/");
    expect(updated.body).toContain('data-connection="partner"');
    expect(updated.body).not.toContain("partner-secret");
  });

  it("persists mappings before backfill, restores them on restart and rejects stale writes", async () => {
    const f = await fixture();
    const revision = settingsVersion(f.config);
    f.engine.reconcile.mockImplementation(async () => {
      expect((await loadSettings(f.config)).mappings).toHaveLength(1);
      return { failed: 0, imported: 1 };
    });
    expect((await f.post(f.mapping)).statusCode).toBe(303);
    expect(f.engine.reconcile).toHaveBeenCalledWith({
      since: "1970-01-01",
      mappingAliases: ["spending"],
    });
    const restored = await loadSettings(
      parseConfig({ ...f.config, mappings: [] }),
    );
    expect(restored.mappings[0]?.upAccountId).toBe(upId);
    expect((await stat(f.config.settingsFile)).mode & 0o777).toBe(0o600);
    expect(await readFile(f.config.settingsFile, "utf8")).not.toContain(
      "test-secret",
    );
    expect(
      (await f.post({ action: "remove-mapping", upAccountId: upId, revision }))
        .statusCode,
    ).toBe(409);
    expect(f.config.mappings).toHaveLength(1);
  });

  it("checks new keys, encrypts them and rejects invalid keys or deleting keys in use", async () => {
    const f = await fixture();
    await f.post({
      action: "connection",
      id: "partner",
      token: "another-secret",
    });
    expect(f.makeClient).toHaveBeenCalledWith("another-secret", "partner");
    expect(f.clients.has("partner")).toBe(true);
    expect(await readFile(f.config.settingsFile, "utf8")).not.toContain(
      "another-secret",
    );
    const restored = await loadSettings(f.config);
    expect(
      connectionToken(
        restored,
        restored.up.connections.find(({ id }) => id === "partner")!,
      ),
    ).toBe("another-secret");
    f.client.ping.mockRejectedValueOnce(new Error("bad-key-secret"));
    await f.post({ action: "connection", id: "bad", token: "bad-key-secret" });
    expect(f.clients.has("bad")).toBe(false);
    await f.post(f.mapping);
    await f.post({ action: "remove-connection", id: "max" });
    expect(f.config.up.connections.some(({ id }) => id === "max")).toBe(true);
    expect(f.runner.history[0]?.state).toBe("failure");
  });

  it("keeps one shared mapping and preserves unavailable fallback keys", async () => {
    const f = await fixture();
    await f.post({
      action: "connection",
      id: "partner",
      token: "another-secret",
    });
    await f.post({ ...f.mapping, connections: ["max", "partner"] });
    f.clients.set("max", {
      listAccounts: vi.fn().mockRejectedValue(new Error("unavailable")),
    } as unknown as UpClientLike);
    await f.post({ ...f.mapping, connections: ["max", "partner"] });
    expect(f.runner.history[0]?.state).toBe("success");
    expect(f.config.mappings).toHaveLength(1);
    expect(f.config.mappings[0]?.connections).toEqual(["max", "partner"]);
  });

  it("rejects inaccessible mappings and failed saves without changing live settings", async () => {
    const f = await fixture();
    await f.post({ ...f.mapping, actualAccountId: "missing" });
    expect(f.config.mappings).toEqual([]);
    await writeFile(f.config.settingsFile, "not a directory");
    f.config.settingsFile += "/settings.json";
    await f.post(f.mapping);
    expect(f.config.mappings).toEqual([]);
    expect(f.engine.reconcile).not.toHaveBeenCalled();
  });

  it("serialises setup behind active work and honours paused automation", async () => {
    const f = await fixture();
    let release!: () => void;
    f.runner.enqueue(
      "test",
      "test",
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    await Promise.resolve();
    f.config.schedule.enabled = false;
    await f.post(f.mapping, false);
    expect(f.config.mappings).toEqual([]);
    expect((await f.post({ action: "discover" }, false)).statusCode).toBe(409);
    release();
    await f.runner.drain();
    expect(f.config.mappings).toHaveLength(1);
    expect(f.engine.reconcile).not.toHaveBeenCalled();
    await f.post({ action: "remove-mapping", upAccountId: upId });
    expect((await loadSettings(f.config)).mappings).toEqual([]);
  });

  it("saves Actual credentials encrypted, supports replacement and rolls back a failed connection", async () => {
    const f = await fixture();
    const command = {
      action: "actual",
      serverUrl: "http://new-actual",
      syncId: "new-budget",
      method: "session",
      credential: "actual-secret-token",
    };
    await f.post(command);
    expect(f.runner.history[0]?.state).toBe("success");
    expect(f.config.actual.serverUrl).toBe("http://new-actual");
    expect(getActualCredentials(await loadSettings(f.config))?.credential).toBe(
      "actual-secret-token",
    );
    expect(await readFile(f.config.settingsFile, "utf8")).not.toContain(
      "actual-secret-token",
    );
    const page = await f.server.inject("/");
    expect(page.body).not.toContain("actual-secret-token");
    await f.post({ ...command, credential: "" });
    expect(getActualCredentials(f.config)?.credential).toBe(
      "actual-secret-token",
    );
    f.actual.open.mockRejectedValueOnce(new Error("upstream contains secret"));
    await f.post({ ...command, credential: "replacement-secret" });
    expect(f.runner.history[0]?.state).toBe("failure");
    expect(getActualCredentials(f.config)?.credential).toBe(
      "actual-secret-token",
    );
    expect(getActualCredentials(await loadSettings(f.config))?.credential).toBe(
      "actual-secret-token",
    );
    await f.post(f.mapping);
    await f.post({ ...command, syncId: "other-budget" });
    expect(f.config.actual.syncId).toBe("new-budget");
  });

  it("fails closed on corrupt persisted settings", async () => {
    const f = await fixture();
    await f.post(f.mapping);
    vi.stubEnv(
      "ACTUAL_UP_ENCRYPTION_KEY",
      "wrong-encryption-key-at-least-32-characters",
    );
    await expect(loadSettings(f.config)).rejects.toThrow();
    vi.stubEnv(
      "ACTUAL_UP_ENCRYPTION_KEY",
      "test-encryption-key-at-least-32-characters",
    );
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
