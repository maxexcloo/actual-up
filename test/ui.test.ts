import pino from "pino";
import { expect, it } from "vitest";
import { parseConfig } from "../src/config.js";
import { JobRunner } from "../src/job-runner.js";
import { Metrics } from "../src/metrics.js";
import { connectionTestStatus, status, statusVersion } from "../src/ui.js";

const { schedule } = parseConfig({
  version: 1,
  actual: { serverUrl: "http://127.0.0.1:5006" },
  up: { connections: [] },
});

it("shows the active job while a newer job waits, and refreshes intermediate progress", async () => {
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
  const version = statusVersion(runner);
  update({ account: "spending", completed: 0, stage: "Read Up", total: 1 });
  expect(statusVersion(runner)).not.toBe(version);
  expect(status(runner, schedule)).toContain("Read Up");
  expect(status(runner, schedule)).toContain("1 queued operation");
  release();
  await runner.drain();
  const html = status(runner, schedule);
  expect(html).toContain("Last Successful Sync:");
  expect(html).toContain(">Completed</wa-badge>");
  expect(html).not.toContain(">Success</wa-badge>");
  expect(html).not.toContain("Last Successful Sync: None in recent activity");
  expect(html.indexOf("Manual Sync")).toBeLessThan(html.indexOf('id="activity"'));
});

it("counts only previous activity and hides an empty history", async () => {
  const runner = new JobRunner(new Metrics(), pino({ enabled: false }));
  runner.enqueue("one", "manual", async () => ({ inspected: 0 }));
  await runner.drain();
  expect(status(runner, schedule)).not.toContain('id="activity"');
  runner.enqueue("two", "manual", async () => ({ inspected: 0 }));
  await runner.drain();
  expect(status(runner, schedule)).toContain("Recent Activity · 1 Run</summary>");
  runner.enqueue("three", "manual", async () => ({ inspected: 0 }));
  await runner.drain();
  expect(status(runner, schedule)).toContain("Recent Activity · 2 Runs</summary>");
});

it("gives connection failures a contextual recovery message", () => {
  expect(connectionTestStatus("actual", "failure")).toContain('variant="danger"');
  expect(connectionTestStatus("actual", "failure")).toContain("retry Test");
  expect(connectionTestStatus("actual", "success")).toContain('variant="success"');
  expect(connectionTestStatus("actual", "busy")).toContain('variant="warning"');
  expect(connectionTestStatus("actual")).not.toContain("<wa-callout");
});
