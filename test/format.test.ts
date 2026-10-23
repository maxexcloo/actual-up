import pino from "pino";
import { expect, it } from "vitest";
import { JobRunner } from "../src/job-runner.js";
import { Metrics } from "../src/metrics.js";
import { elapsed, plural, stateLabel, summarise } from "../web/src/format.js";

it("shows the active job while a newer job waits, and follows intermediate progress", async () => {
  const runner = new JobRunner(new Metrics(), pino({ enabled: false }));
  let release!: () => void;
  let update!: Parameters<Parameters<JobRunner["enqueue"]>[2]>[0];
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  runner.enqueue(
    "a",
    "manual",
    async (progress) => {
      update = progress;
      await gate;
      return { failed: 0 };
    },
    { account: "spending" },
  );
  runner.enqueue("b", "test-connection", async () => ({ ok: true }));
  await Promise.resolve();
  update({ account: "spending", completed: 0, stage: "Read Up", total: 1 });
  const running = summarise(runner.history);
  expect(running.heading).toBe("Manual Sync");
  expect(running.active?.progress?.stage).toBe("Read Up");
  expect(running.queued).toBe(1);
  release();
  await runner.drain();
  const done = summarise(runner.history);
  expect(done.heading).toBe("Sync Status");
  expect(stateLabel(done.state)).toBe("Completed");
  expect(done.lastSuccess?.trigger).toBe("manual");
});

it("counts only previous activity", async () => {
  const runner = new JobRunner(new Metrics(), pino({ enabled: false }));
  runner.enqueue("one", "manual", async () => ({ inspected: 0 }));
  await runner.drain();
  expect(summarise(runner.history).recent).toHaveLength(0);
  runner.enqueue("two", "manual", async () => ({ inspected: 0 }));
  await runner.drain();
  expect(plural(summarise(runner.history).recent.length, "Run")).toBe("1 Run");
});

it("flags failed syncs and ignores previews and unpublished runs as last success", async () => {
  const runner = new JobRunner(new Metrics(), pino({ enabled: false }));
  runner.enqueue("preview", "dry-run", async () => ({ inspected: 1 }));
  runner.enqueue("quiet", "schedule", async () => ({ inspected: 0, publication: "not-required" }));
  runner.enqueue("broken", "manual", async () => {
    throw new Error("upstream");
  });
  await runner.drain();
  const summary = summarise(runner.history);
  expect(summary.heading).toBe("Sync Needs Attention");
  expect(summary.lastSuccess).toBeUndefined();
  expect(elapsed(new Date(0).toISOString(), 125_000)).toBe("2m 5s");
});
