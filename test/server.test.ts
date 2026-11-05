import pino from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseConfig } from "../src/config.js";
import { JobRunner } from "../src/job-runner.js";
import { LogBuffer } from "../src/logs.js";
import { Metrics } from "../src/metrics.js";
import { createServer } from "../src/server.js";
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
  vi.stubEnv("ACTUAL_UP_ENCRYPTION_KEY", "test-encryption-key-at-least-32-characters");
  vi.stubEnv("ACTUAL_UP_USERNAME", "operator");
  vi.stubEnv("ACTUAL_UP_PASSWORD", password);
  const config = parseConfig({
    version: 1,
    actual: {
      serverUrl: "http://actual",
      syncId: "budget",
    },
    up: { connections: [{ id: "max" }] },
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
    getAccounts: vi.fn().mockResolvedValue([{ id: "actual-id", name: "Spending" }]),
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
  const server = await createServer(config, {
    actual: actual as unknown as ActualClient,
    clients: new Map([["max", client as unknown as UpClientLike]]),
    engine: engine as unknown as SyncEngine,
    logger,
    logs: new LogBuffer(),
    metrics,
    runner,
  });
  servers.push(server);
  const login = await server.inject({
    method: "POST",
    url: "/login",
    headers: { origin: config.server.publicUrl ?? "http://localhost:80" },
    payload: { username: "operator", password },
  });
  expect(login.statusCode).toBe(204);
  headers.cookie = String(login.headers["set-cookie"]).split(";")[0]!;
  return { actual, client, config, engine, runner, server };
}

const headers = {
  cookie: "",
  origin: "http://localhost:80",
};

describe("operator app", () => {
  it("returns client errors for unsupported and oversized bodies", async () => {
    const { server } = await fixture();
    const form = await server.inject({
      method: "POST",
      url: "/actions/sync",
      headers: { ...headers, "content-type": "application/x-www-form-urlencoded" },
      payload: "mode=live",
    });
    expect(form.statusCode).toBe(415);
    const large = await server.inject({
      method: "POST",
      url: "/actions/sync",
      headers,
      payload: { mode: "live", since: "x".repeat(70_000) },
    });
    expect(large.statusCode).toBe(413);
  });

  it("uses the public URL override for Secure cookies and origin checks", async () => {
    vi.stubEnv("ACTUAL_UP_PUBLIC_URL", "https://private.example.com");
    const { server } = await fixture();
    const login = await server.inject({
      method: "POST",
      url: "/login",
      headers: { ...headers, origin: "https://private.example.com" },
      payload: { username: "operator", password },
    });
    expect(login.statusCode).toBe(204);
    expect(String(login.headers["set-cookie"])).toContain("; Secure");
    const rejected = await server.inject({
      method: "POST",
      url: "/login",
      headers,
      payload: { username: "operator", password },
    });
    expect(rejected.statusCode).toBe(403);
  });

  it("serves the app shell publicly, but protects state and actions, while allowing probes", async () => {
    const { server, runner } = await fixture();
    for (const url of ["/", "/login"]) {
      const shell = await server.inject(url);
      expect(shell.statusCode).toBe(200);
      expect(shell.body).toContain('<div id="root">');
      const nonce = /'nonce-([^']+)'/.exec(String(shell.headers["content-security-policy"]))?.[1];
      expect(nonce).toBeTruthy();
      expect(shell.body).toContain(`<meta name="style-nonce" content="${nonce}"`);
    }
    const script = /src="(\/assets\/[^"]+\.js)"/.exec((await server.inject("/")).body)?.[1];
    expect((await server.inject(script!)).statusCode).toBe(200);
    for (const url of ["/state", "/settings"])
      expect((await server.inject(url)).statusCode).toBe(401);
    expect(
      (
        await server.inject({
          method: "POST",
          payload: { mode: "live" },
          url: "/actions/sync",
          headers: { origin: headers.origin },
        })
      ).statusCode,
    ).toBe(401);
    expect(runner.depth).toBe(0);
    expect((await server.inject("/livez")).statusCode).toBe(200);
    const state = await server.inject({ headers, url: "/state" });
    expect(state.statusCode).toBe(200);
    expect(state.json().schedule.enabled).toBe(true);
    expect(state.headers["cache-control"]).toBe("no-store");
    expect(state.body).not.toContain(password);
  });

  it("signs in with JSON, rejects cross-site login and invalidates sessions on logout", async () => {
    const { server } = await fixture();
    expect(
      (
        await server.inject({
          method: "POST",
          url: "/login",
          headers: { ...headers, origin: "https://other.example" },
          payload: { username: "operator", password: "wrong" },
        })
      ).statusCode,
    ).toBe(403);
    const rejected = await server.inject({
      headers,
      method: "POST",
      payload: { username: "operator", password: "wrong" },
      url: "/login",
    });
    expect(rejected.statusCode).toBe(401);
    expect(rejected.json().error).toBe("Incorrect username or password.");
    expect(rejected.headers["set-cookie"]).toBeUndefined();
    expect(rejected.headers["www-authenticate"]).toBeUndefined();
    const logout = await server.inject({ headers, method: "POST", url: "/logout" });
    expect(logout.statusCode).toBe(204);
    expect(logout.headers["set-cookie"]).toContain("Max-Age=0");
    expect((await server.inject({ headers, url: "/state" })).statusCode).toBe(401);
  });

  it("limits sign-in attempts by the client address the proxy forwarded", async () => {
    const { server } = await fixture();
    const attempt = (forwarded: string) =>
      server.inject({
        headers: { ...headers, "x-forwarded-for": forwarded },
        method: "POST",
        payload: { username: "operator", password: "wrong" },
        url: "/login",
      });
    for (let index = 0; index < 10; index += 1)
      expect((await attempt("203.0.113.1")).statusCode).toBe(401);
    expect((await attempt("203.0.113.1")).statusCode).toBe(429);
    expect((await attempt("203.0.113.9, 203.0.113.1")).statusCode).toBe(429);
    expect((await attempt("203.0.113.2")).statusCode).toBe(401);
  });

  it("expires opaque sessions after eight hours and rejects forged cookies", async () => {
    const { server } = await fixture();
    expect(headers.cookie).not.toContain("operator");
    expect(headers.cookie).not.toContain(password);
    expect(
      (
        await server.inject({
          url: "/state",
          headers: { cookie: "actual_up_session=forged" },
        })
      ).statusCode,
    ).toBe(401);
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now + 8 * 60 * 60 * 1000 + 1);
    try {
      expect(
        (await server.inject({ url: "/state", headers: { cookie: headers.cookie } })).statusCode,
      ).toBe(401);
    } finally {
      clock.mockRestore();
    }
  });

  it("answers unchanged state polls without a body and reports background runs", async () => {
    const { server, runner } = await fixture();
    const first = await server.inject({ headers, url: "/state" });
    await runner.drain();
    const settled = await server.inject({ headers, url: "/state" });
    const etag = String(settled.headers.etag);
    expect(etag).not.toBe(String(first.headers.etag));
    const unchanged = await server.inject({
      headers: { ...headers, "if-none-match": etag },
      url: "/state",
    });
    expect(unchanged.statusCode).toBe(304);
    expect(unchanged.body).toBe("");
    runner.enqueue("schedule", "schedule", async () => report);
    await runner.drain();
    const response = await server.inject({
      headers: { ...headers, "if-none-match": etag },
      url: "/state",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().jobs[0]).toMatchObject({
      trigger: "schedule",
      state: "success",
      result: { imported: 1 },
    });
  });

  it("rejects cross-site writes, invalid dates and unknown account aliases", async () => {
    const { server, runner } = await fixture();
    for (const origin of ["https://attacker.example", ""])
      expect(
        (
          await server.inject({
            method: "POST",
            payload: { mode: "live" },
            url: "/actions/sync",
            headers: { ...headers, origin },
          })
        ).statusCode,
      ).toBe(403);
    for (const payload of [
      { mode: "live", since: "2026-02-30" },
      { mode: "live", account: "missing" },
      { mode: "unknown" },
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
          payload: {},
        })
      ).statusCode,
    ).toBe(403);
    expect(runner.depth).toBe(0);
  });

  it("queues dry runs with account selection and backfill", async () => {
    const { server, runner, engine } = await fixture();
    const response = await server.inject({
      headers,
      method: "POST",
      payload: { mode: "dry-run", account: "spending", since: "2025-01-01" },
      url: "/actions/sync",
    });
    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({
      accepted: true,
      message: "Queued. Follow progress in Sync Status.",
    });
    await runner.drain();
    expect(engine.reconcile).toHaveBeenCalledWith({
      dryRun: true,
      progress: expect.any(Function),
      since: "2025-01-01",
      mappingAliases: ["spending"],
    });
    expect(runner.history[0]?.state).toBe("success");
  });

  it.each(["renamed", "disconnected"])(
    "keeps queued account syncs scoped when their mapping is %s",
    async (change) => {
      const { server, runner, engine, config } = await fixture();
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      runner.enqueue("block", "manual", () => gate);
      await server.inject({
        headers,
        method: "POST",
        payload: { mode: "live", account: "spending" },
        url: "/actions/sync",
      });
      if (change === "renamed") config.mappings[0]!.alias = "new-name";
      else config.mappings = [];
      release();
      await runner.drain();
      if (change === "renamed") {
        expect(engine.reconcile).toHaveBeenCalledWith(
          expect.objectContaining({
            mappingAliases: ["new-name"],
          }),
        );
        expect(runner.history[0]?.state).toBe("success");
      } else {
        expect(engine.reconcile).not.toHaveBeenCalled();
        expect(runner.history[0]?.state).toBe("failure");
      }
    },
  );

  it("shows only safe log fields in the browser", async () => {
    const logs = new LogBuffer();
    pino(logs).warn({ account: "spending", payee: "Cafe", status: 503 }, "Retrying Up API");
    await vi.waitFor(() => expect(logs.entries).toHaveLength(1));
    expect(logs.entries[0]).toMatchObject({
      level: "warn",
      message: "Retrying Up API",
      context: "account=spending status=503",
    });
  });
});
