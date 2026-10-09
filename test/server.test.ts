import pino from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseConfig } from "../src/config.js";
import { JobRunner } from "../src/job-runner.js";
import { Metrics } from "../src/metrics.js";
import { createServer } from "../src/server.js";
import { statusVersion } from "../src/ui.js";
import type { SyncEngine } from "../src/sync-engine.js";
import type { ActualClient, UpClientLike } from "../src/types.js";

const logger = pino({ enabled: false });
const password = "test-password-long-enough";

const report = {
  conflicts: 0,
  deleted: 0,
  failed: 0,
  imported: 1,
  inspected: 1,
  updated: 0,
};
const servers: Array<Awaited<ReturnType<typeof createServer>>> = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
  vi.unstubAllEnvs();
});

async function fixture() {
  vi.stubEnv(
    "ACTUAL_UP_ENCRYPTION_KEY",
    "test-encryption-key-at-least-32-characters",
  );
  vi.stubEnv("ACTUAL_UP_USERNAME", "operator");
  vi.stubEnv("ACTUAL_UP_PASSWORD", password);
  const config = parseConfig({
    version: 1,
    actual: {
      passwordEnv: "ACTUAL_PASSWORD",
      serverUrl: "http://actual",
      syncId: "budget",
    },
    up: { connections: [{ id: "max", tokenEnv: "UP_TOKEN" }] },
    mappings: [
      {
        actualAccountId: "actual-id",
        alias: "spending",
        upAccountId: "11111111-1111-4111-8111-111111111111",
        connections: ["max"],
      },
    ],
  });
  const metrics = new Metrics();
  const runner = new JobRunner(metrics, logger);
  const engine = {
    reconcile: vi.fn().mockResolvedValue(report),
    validate: vi.fn().mockResolvedValue({ actualVersion: "26.10.0" }),
  };
  const actual = {
    getServerVersion: vi.fn().mockResolvedValue("26.10.0"),
    sync: vi.fn(),
    getAccounts: vi
      .fn()
      .mockResolvedValue([{ id: "actual-id", name: "Spending" }]),
    getCategories: vi.fn().mockResolvedValue([]),
  };
  const client = {
    ping: vi.fn(),
    listAccounts: vi.fn().mockResolvedValue([
      {
        id: "up-id",
        attributes: {
          displayName: "<script>alert(1)</script>",
          balance: { value: "sensitive-balance" },
        },
      },
    ]),
  };
  const server = await createServer(
    config,
    engine as unknown as SyncEngine,
    runner,
    metrics,
    logger,
    {
      actual: actual as unknown as ActualClient,
      clients: new Map([["max", client as unknown as UpClientLike]]),
    },
  );
  servers.push(server);
  const login = await server.inject({
    method: "POST",
    url: "/login",
    headers: {
      origin: "http://localhost:80",
      "content-type": "application/x-www-form-urlencoded",
    },
    payload: `username=operator&password=${password}`,
  });
  expect(login.statusCode).toBe(303);
  headers.cookie = String(login.headers["set-cookie"]).split(";")[0]!;
  return { actual, client, config, engine, runner, server };
}

const headers = {
  cookie: "",
  origin: "http://localhost:80",
  "content-type": "application/x-www-form-urlencoded",
  "hx-request": "true",
};

describe("operator app", () => {
  it("protects the app, assets and actions, while allowing probes", async () => {
    const { server, runner } = await fixture();
    for (const url of ["/", "/settings", "/runs", "/assets/htmx.js"])
      expect((await server.inject(url)).statusCode).toBe(303);
    expect(
      (
        await server.inject({
          method: "POST",
          payload: "mode=live",
          url: "/actions/sync",
          headers: {
            "content-type": headers["content-type"],
            origin: headers.origin,
          },
        })
      ).statusCode,
    ).toBe(303);
    expect(runner.depth).toBe(0);
    expect((await server.inject("/livez")).statusCode).toBe(200);
    const page = await server.inject({
      headers,
      url: "/",
    });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain("Automatic Sync On");
    expect(page.headers["cache-control"]).toBe("no-store");
    expect(page.body).not.toContain(password);
  });

  it("uses a normal login page, rejects cross-site login and invalidates sessions on logout", async () => {
    const { server } = await fixture();
    const page = await server.inject("/login");
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('autocomplete="current-password"');
    expect(page.headers["www-authenticate"]).toBeUndefined();
    expect(
      (
        await server.inject({
          method: "POST",
          url: "/login",
          headers: { ...headers, origin: "https://other.example" },
          payload: "username=operator&password=wrong",
        })
      ).statusCode,
    ).toBe(403);
    const rejected = await server.inject({
      headers,
      method: "POST",
      payload: "username=operator&password=wrong",
      url: "/login",
    });
    expect(rejected.statusCode).toBe(401);
    expect(rejected.headers["set-cookie"]).toBeUndefined();
    const logout = await server.inject({
      headers,
      method: "POST",
      payload: "",
      url: "/logout",
    });
    expect(logout.headers["set-cookie"]).toContain("Max-Age=0");
    const expired = await server.inject({ headers, url: "/runs" });
    expect(expired.statusCode).toBe(200);
    expect(expired.headers["hx-redirect"]).toBe("/login");
    expect(
      (await server.inject({ url: "/", headers: { cookie: headers.cookie } }))
        .statusCode,
    ).toBe(303);
  });

  it("leaves an unchanged status panel intact and detects background runs", async () => {
    const { server, runner } = await fixture();
    const version = statusVersion(runner);
    const url = `/runs?version=${encodeURIComponent(version)}`;
    expect((await server.inject({ headers, url })).statusCode).toBe(204);
    runner.enqueue("schedule", "schedule", async () => report);
    await runner.drain();
    const response = await server.inject({ headers, url });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("Scheduled Sync");
    expect(response.body).toContain("imported");
  });

  it("rejects cross-site writes, invalid dates and unknown account aliases", async () => {
    const { server, runner } = await fixture();
    for (const origin of ["https://attacker.example", ""])
      expect(
        (
          await server.inject({
            method: "POST",
            payload: "mode=live",
            url: "/actions/sync",
            headers: { ...headers, origin },
          })
        ).statusCode,
      ).toBe(403);
    for (const payload of [
      "mode=live&since=2026-02-30",
      "mode=live&account=missing",
      "mode=unknown",
    ])
      expect(
        (
          await server.inject({
            headers,
            method: "POST",
            payload,
            url: "/actions/sync",
          })
        ).statusCode,
      ).toBe(400);
    expect(
      (
        await server.inject({
          method: "POST",
          url: "/settings",
          headers: { ...headers, origin: "https://attacker.example" },
          payload: "action=discover",
        })
      ).statusCode,
    ).toBe(403);
    expect(runner.depth).toBe(0);
  });

  it("queues dry runs with account selection and backfill, refreshing Actual first", async () => {
    const { server, runner, engine, actual } = await fixture();
    const response = await server.inject({
      headers,
      method: "POST",
      payload: "mode=dry-run&account=spending&since=2025-01-01",
      url: "/actions/sync",
    });
    expect(response.statusCode).toBe(200);
    await runner.drain();
    expect(engine.reconcile).toHaveBeenCalledWith({
      dryRun: true,
      since: "2025-01-01",
      mappingAliases: ["spending"],
    });
    expect(actual.sync.mock.invocationCallOrder[0]).toBeLessThan(
      engine.reconcile.mock.invocationCallOrder[0]!,
    );
    expect(runner.history[0]?.state).toBe("success");
  });

  it("limits connection syncs to their mapped accounts and includes shared accounts once", async () => {
    const { server, runner, engine, config } = await fixture();
    config.up.connections.push({ id: "partner", tokenEnv: "UP_PARTNER" });
    config.mappings[0]!.connections.push("partner");
    config.mappings.push({
      actualAccountId: "savings",
      alias: "savings",
      upAccountId: "22222222-2222-4222-8222-222222222222",
      connections: ["partner"],
    });
    for (const [connection, aliases] of [
      ["max", ["spending"]],
      ["partner", ["spending", "savings"]],
    ] as const) {
      await server.inject({
        headers,
        method: "POST",
        payload: `mode=live&connection=${connection}`,
        url: "/actions/sync",
      });
      await runner.drain();
      expect(engine.reconcile).toHaveBeenLastCalledWith({
        dryRun: false,
        mappingAliases: aliases,
        since: undefined,
      });
    }
    for (const scope of [
      "connection=missing",
      "connection=max&account=spending",
    ])
      expect(
        (
          await server.inject({
            headers,
            method: "POST",
            payload: `mode=live&${scope}`,
            url: "/actions/sync",
          })
        ).statusCode,
      ).toBe(400);
  });

  it("tests Actual and individual Up connections without importing, and reports safe inline failures", async () => {
    const { server, runner, actual, client, engine } = await fixture();
    for (const payload of ["target=actual", "target=up&connection=max"]) {
      const queued = await server.inject({
        headers,
        method: "POST",
        payload,
        url: "/actions/test",
      });
      expect(queued.statusCode).toBe(200);
      await runner.drain();
    }
    expect(actual.getServerVersion).toHaveBeenCalledOnce();
    expect(client.ping).toHaveBeenCalledOnce();
    expect(engine.reconcile).not.toHaveBeenCalled();
    expect(actual.sync).not.toHaveBeenCalled();
    const result = await server.inject({
      headers,
      url: "/connection-tests/up-max",
    });
    expect(result.body).toContain("Connection Working");
    client.ping.mockRejectedValueOnce(new Error("sensitive-token"));
    await server.inject({
      headers,
      method: "POST",
      payload: "target=up&connection=max",
      url: "/actions/test",
    });
    await runner.drain();
    const failed = await server.inject({
      headers,
      url: "/connection-tests/up-max",
    });
    expect(failed.body).toContain("Connection Failed");
    expect(failed.body).not.toContain("sensitive-token");
    expect(
      (
        await server.inject({
          headers,
          method: "POST",
          payload: "target=up&connection=missing",
          url: "/actions/test",
        })
      ).statusCode,
    ).toBe(400);
  });

  it("keeps discovery balances out of results and escapes upstream names", async () => {
    const { server, runner } = await fixture();
    await server.inject({
      headers,
      method: "POST",
      payload: "",
      url: "/actions/discover",
    });
    await runner.drain();
    const response = await server.inject({ headers, url: "/runs" });
    expect(response.body).not.toContain("sensitive-balance");
    expect(response.body).not.toContain("<script>alert");
    expect(response.body).toContain("&lt;script&gt;");
  });
});
