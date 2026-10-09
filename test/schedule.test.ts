import pino from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";

import { parseConfig } from "../src/config.js";
import { JobRunner } from "../src/job-runner.js";
import { Metrics } from "../src/metrics.js";
import { startSchedule } from "../src/schedule.js";
import type { SyncEngine } from "../src/sync-engine.js";

let stop = () => {};
afterEach(() => {
  stop();
  vi.useRealTimers();
});
function fixture(enabled = true, mapped = true) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-08T15:59:50Z")); // 02:59:50 in Sydney.
  const config = parseConfig({
    version: 1,
    actual: {
      passwordEnv: "ACTUAL_PASSWORD",
      serverUrl: "http://actual",
      syncId: "budget",
    },
    up: { connections: [{ id: "first", tokenEnv: "UP_TOKEN" }] },
    schedule: { enabled },
    mappings: mapped
      ? [
          {
            actualAccountId: "spending",
            alias: "spending",
            upAccountId: "11111111-1111-4111-8111-111111111111",
            connections: ["first"],
          },
        ]
      : [],
  });
  const actual = { sync: vi.fn().mockResolvedValue(undefined) };
  const engine = { reconcile: vi.fn().mockResolvedValue({ failed: 0 }) };
  const runner = new JobRunner(new Metrics(), pino({ enabled: false }));
  stop = startSchedule(config, engine as unknown as SyncEngine, runner, actual);
  return { actual, engine, runner };
}

describe("automatic reconciliation", () => {
  it("backfills on startup and nightly, and syncs recent transactions every 15 minutes", async () => {
    const { actual, engine, runner } = fixture();
    await runner.drain();
    expect(engine.reconcile).toHaveBeenCalledWith({ since: "1970-01-01" });
    expect(actual.sync.mock.invocationCallOrder[0]).toBeLessThan(
      engine.reconcile.mock.invocationCallOrder[0]!,
    );
    engine.reconcile.mockClear();
    await vi.advanceTimersByTimeAsync(10_000);
    await runner.drain();
    expect(engine.reconcile.mock.calls).toEqual(
      expect.arrayContaining([[{}], [{ since: "1970-01-01" }]]),
    );
    engine.reconcile.mockClear();
    await vi.advanceTimersByTimeAsync(15 * 60_000);
    await runner.drain();
    expect(engine.reconcile).toHaveBeenCalledExactlyOnceWith({});
    stop();
    await vi.advanceTimersByTimeAsync(24 * 60 * 60_000);
    expect(engine.reconcile).toHaveBeenCalledTimes(1);
  });

  it("leaves a new installation idle until accounts are mapped", async () => {
    const { engine, runner } = fixture(true, false);
    await vi.advanceTimersByTimeAsync(24 * 60 * 60_000);
    await runner.drain();
    expect(engine.reconcile).not.toHaveBeenCalled();
  });

  it("does not write or schedule when explicitly disabled", async () => {
    const { engine, runner } = fixture(false);
    await vi.advanceTimersByTimeAsync(24 * 60 * 60_000);
    await runner.drain();
    expect(engine.reconcile).not.toHaveBeenCalled();
  });

  it("retries an incomplete backfill on the next nightly run", async () => {
    const { engine, runner } = fixture();
    engine.reconcile.mockResolvedValueOnce({ failed: 1 });
    await runner.drain();
    expect(runner.history[0]?.state).toBe("failure");
    await vi.advanceTimersByTimeAsync(10_000);
    await runner.drain();
    expect(
      engine.reconcile.mock.calls.filter(([options]) => options.since),
    ).toHaveLength(2);
    expect(
      runner.history.find((job) => job.trigger === "automatic-backfill")?.state,
    ).toBe("success");
  });
});
