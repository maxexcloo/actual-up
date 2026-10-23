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
import { connectionToken, loadSettings, settingsVersion } from "../src/settings-store.js";
import type { SyncEngine } from "../src/sync-engine.js";
import type { AppState } from "../src/api.js";
import type { ActualClient, UpClientLike } from "../src/types.js";

const upId = "11111111-1111-4111-8111-111111111111";
const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.unstubAllEnvs();
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "actual-up-settings-"));
  cleanups.push(() => rm(directory, { force: true, recursive: true }));
  vi.stubEnv("ACTUAL_UP_ENCRYPTION_KEY", "test-encryption-key-at-least-32-characters");
  const config = parseConfig({
    version: 1,
    settingsFile: join(directory, "settings.json"),
    actual: {
      serverUrl: "http://actual",
      syncId: "budget",
    },
    up: { connections: [{ id: "max" }] },
  });
  config.secrets.tokens.max = "test-secret-never-render";
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
  const clients = new Map<string, UpClientLike>([["max", client as unknown as UpClientLike]]);
  const actual = {
    open: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    getServerVersion: vi.fn().mockResolvedValue("26.10.0"),
    sync: vi.fn().mockResolvedValue(undefined),
    getAccounts: vi.fn().mockResolvedValue([{ id: "actual-id", name: "Spending" }]),
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
      payload: {
        revision: settingsVersion(
          typeof data.upAccountId === "string" ? data.upAccountId : undefined,
        ),
        ...data,
      },
    });
    if (drain) await runner.drain();
    return result;
  };
  const update = async (id: string) =>
    ((await server.inject("/state")).json() as AppState).accounts.find(
      (account) => account.id === id,
    )?.update;
  const mapping = {
    action: "mapping",
    actualAccountId: "actual-id",
    alias: "spending",
    upAccountId: upId,
    connections: ["max"],
  };
  return {
    actual,
    client,
    clients,
    config,
    engine,
    makeClient,
    mapping,
    post,
    runner,
    server,
    update,
  };
}

describe("browser setup", () => {
  it("rejects invalid account submissions without changing the mapping", async () => {
    const f = await fixture();
    await f.post({
      action: "connection",
      id: "partner",
      token: "test-partner",
    });
    await f.post({ ...f.mapping, connections: ["max", "partner"] });
    const { connections: _connections, ...mapping } = f.mapping;
    const response = await f.server.inject({
      method: "POST",
      url: "/settings",
      payload: { ...mapping, revision: settingsVersion(upId) },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "Invalid settings. Reload the page and try again." });
    expect(f.config.mappings[0]?.connections).toEqual(["max", "partner"]);
  });

  it("discovers accounts without balances and never exposes keys", async () => {
    const f = await fixture();
    await f.post({ action: "discover" });
    const page = await f.server.inject("/state");
    expect(page.json().accounts[0].name).toBe("<script>bad</script>");
    expect(page.body).not.toContain("private-balance");
    expect(page.body).not.toContain("test-secret-never-render");
  });

  it("discovers automatically on first visit and after adding a connection", async () => {
    const f = await fixture();
    await f.server.inject("/state");
    await f.runner.drain();
    expect(f.client.listAccounts).toHaveBeenCalledOnce();
    const page = (await f.server.inject("/state")).json();
    expect(page.connections.map(({ id }: { id: string }) => id)).toEqual(["max"]);
    expect(page.accounts[0]).toMatchObject({ id: upId, connections: ["max"] });
    await f.post({
      action: "connection",
      id: "partner",
      token: "partner-secret",
    });
    const updated = await f.server.inject("/state");
    expect(updated.json().connections.map(({ id }: { id: string }) => id)).toEqual([
      "max",
      "partner",
    ]);
    expect(updated.body).not.toContain("partner-secret");
  });

  it("persists mappings before backfill, restores them on restart and rejects stale writes", async () => {
    const f = await fixture();
    const revision = settingsVersion(upId);
    f.engine.reconcile.mockImplementation(async () => {
      expect((await loadSettings(f.config)).mappings).toHaveLength(1);
      return { failed: 0, imported: 1 };
    });
    expect((await f.post(f.mapping)).statusCode).toBe(202);
    expect(f.engine.reconcile).toHaveBeenCalledWith({
      since: "1970-01-01",
      progress: expect.any(Function),
      mappingAliases: ["spending"],
    });
    const restored = await loadSettings(parseConfig({ ...f.config, mappings: [] }));
    expect(restored.mappings[0]?.upAccountId).toBe(upId);
    expect((await stat(f.config.settingsFile)).mode & 0o777).toBe(0o600);
    expect(await readFile(f.config.settingsFile, "utf8")).not.toContain("test-secret");
    expect(
      (await f.post({ action: "remove-mapping", revision, upAccountId: upId })).statusCode,
    ).toBe(409);
    expect(f.config.mappings).toHaveLength(1);
  });

  it("does not backfill again when an existing account name is edited", async () => {
    const f = await fixture();
    await f.post(f.mapping);
    f.engine.reconcile.mockClear();
    f.client.listAccounts.mockClear().mockRejectedValue(new Error("unavailable"));
    f.actual.getAccounts.mockClear().mockRejectedValue(new Error("unavailable"));
    await f.post({ ...f.mapping, alias: "renamed" });
    expect(f.config.mappings[0]?.alias).toBe("renamed");
    expect(f.client.listAccounts).not.toHaveBeenCalled();
    expect(f.actual.getAccounts).not.toHaveBeenCalled();
    expect(f.engine.reconcile).not.toHaveBeenCalled();
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
    expect(await readFile(f.config.settingsFile, "utf8")).not.toContain("another-secret");
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
    const page = (await f.server.inject("/state")).json();
    expect(page.accounts).toHaveLength(1);
    expect(page.accounts[0]).toMatchObject({
      connections: ["max", "partner"],
      mapping: {
        alias: "spending",
        actualAccountName: "Spending",
        connections: ["max", "partner"],
      },
    });
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
    expect((await loadSettings(f.config)).secrets.actual?.credential).toBe("actual-secret-token");
    expect(await readFile(f.config.settingsFile, "utf8")).not.toContain("actual-secret-token");
    const page = await f.server.inject("/state");
    expect(page.json().actual).toMatchObject({ configured: true, method: "session" });
    expect(page.body).not.toContain("actual-secret-token");
    await f.post({ ...command, credential: "" });
    expect(f.config.secrets.actual?.credential).toBe("actual-secret-token");
    f.actual.open.mockRejectedValueOnce(new Error("upstream contains secret"));
    await f.post({ ...command, credential: "replacement-secret" });
    expect(f.runner.history[0]?.state).toBe("failure");
    expect(f.config.secrets.actual?.credential).toBe("actual-secret-token");
    expect((await loadSettings(f.config)).secrets.actual?.credential).toBe("actual-secret-token");
    await f.post(f.mapping);
    await f.post({ ...command, syncId: "other-budget" });
    expect(f.config.actual.syncId).toBe("new-budget");
  });

  it("accepts independent account saves from the same page and rejects duplicate destinations", async () => {
    const f = await fixture();
    const secondId = "22222222-2222-4222-8222-222222222222";
    f.client.listAccounts.mockResolvedValue([
      {
        id: upId,
        attributes: { displayName: "Everyday", balance: { value: "private" } },
      },
      {
        id: secondId,
        attributes: { displayName: "Savings", balance: { value: "private" } },
      },
    ]);
    f.actual.getAccounts.mockResolvedValue([
      { id: "actual-id", name: "Spending" },
      { id: "actual-2", name: "Savings" },
    ]);
    await f.post({ action: "discover" });
    let release!: () => void;
    f.runner.enqueue(
      "hold",
      "test",
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    await Promise.resolve();
    const submit = (id: string, destination: string) =>
      f.server.inject({
        method: "POST",
        url: "/settings",
        payload: {
          ...f.mapping,
          alias: id === upId ? "Everyday" : "Savings",
          upAccountId: id,
          actualAccountId: destination,
          revision: settingsVersion(id),
        },
      });
    try {
      const first = await submit(upId, "actual-id");
      const second = await submit(secondId, "actual-2");
      expect(first.statusCode).toBe(202);
      expect(second.statusCode).toBe(202);
      expect(first.json()).toEqual({ accepted: true, message: "Save queued." });
      expect((await submit(upId, "actual-id")).statusCode).toBe(409);
      expect((await f.update(secondId))?.pending).toBe(true);
    } finally {
      release();
    }
    await f.runner.drain();
    expect(f.config.mappings).toHaveLength(2);
    expect(f.engine.reconcile).toHaveBeenCalledTimes(2);
    expect((await f.update(secondId))?.message).toContain("Saved.");
    await f.post({ action: "remove-mapping", upAccountId: secondId });
    await submit(secondId, "actual-id");
    await f.runner.drain();
    expect(f.config.mappings).toHaveLength(1);
    expect((await f.update(secondId))?.message).toContain("only be mapped once");
  });

  it("keeps other account saves available while history backfills", async () => {
    const f = await fixture();
    const secondId = "22222222-2222-4222-8222-222222222222";
    f.client.listAccounts.mockResolvedValue([
      {
        id: upId,
        attributes: { displayName: "Everyday", balance: { value: "private" } },
      },
      {
        id: secondId,
        attributes: { displayName: "Savings", balance: { value: "private" } },
      },
    ]);
    f.actual.getAccounts.mockResolvedValue([
      { id: "actual-id", name: "Spending" },
      { id: "actual-2", name: "Savings" },
    ]);
    const revision = settingsVersion(secondId);
    let release!: () => void;
    f.engine.reconcile.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ failed: 0, imported: 1 });
        }),
    );
    await f.post(f.mapping, false);
    await vi.waitFor(() => expect(release).toBeDefined());
    try {
      expect((await f.update(upId))?.message).toContain("backfill queued");
      expect((await f.server.inject("/state")).json().busy).toBe(false);
      const second = await f.post(
        {
          ...f.mapping,
          alias: "Savings",
          upAccountId: secondId,
          actualAccountId: "actual-2",
          revision,
        },
        false,
      );
      expect(second.statusCode).toBe(202);
      expect(f.config.mappings).toHaveLength(1);
    } finally {
      release();
    }
    await f.runner.drain();
    expect(f.config.mappings).toHaveLength(2);
  });

  it("fails closed on corrupt persisted settings", async () => {
    const f = await fixture();
    await f.post(f.mapping);
    vi.stubEnv("ACTUAL_UP_ENCRYPTION_KEY", "wrong-encryption-key-at-least-32-characters");
    await expect(loadSettings(f.config)).rejects.toThrow();
    vi.stubEnv("ACTUAL_UP_ENCRYPTION_KEY", "test-encryption-key-at-least-32-characters");
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
