import pino from "pino";
import { describe, expect, it } from "vitest";
import { JobRunner } from "../src/job-runner.js";
import { Metrics } from "../src/metrics.js";

function runner() {
  return new JobRunner(new Metrics(), pino({ enabled: false }));
}

describe("operation queue", () => {
  it("serialises whole operations, deduplicates and survives failures", async () => {
    const queue = runner();
    const calls: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    queue.enqueue("a", "manual", async () => {
      calls.push("read");
      await gate;
      calls.push("write");
      throw new Error("sensitive upstream response");
    });
    expect(queue.enqueue("a", "manual", async () => {})).toBe(false);
    queue.enqueue("b", "schedule", async () => {
      calls.push("next");
      return { failed: 1 };
    });
    await Promise.resolve();
    expect(calls).toEqual(["read"]);
    release();
    await queue.drain();
    expect(calls).toEqual(["read", "write", "next"]);
    expect(queue.history.map((job) => job.state)).toEqual([
      "failure",
      "failure",
    ]);
    expect(JSON.stringify(queue.history)).not.toContain(
      "sensitive upstream response",
    );
    expect(queue.depth).toBe(0);
    await queue.close();
    expect(queue.enqueue("c", "manual", async () => {})).toBe(false);
  });

  it("bounds the queue and recent history", async () => {
    const queue = runner();
    for (let i = 0; i < 32; i++)
      expect(queue.enqueue(String(i), "webhook", async () => ({}))).toBe(true);
    expect(queue.enqueue("overflow", "webhook", async () => ({}))).toBe(false);
    await queue.drain();
    expect(queue.history).toHaveLength(20);
  });
});
