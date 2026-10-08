import { randomUUID } from "node:crypto";
import type { Logger } from "pino";
import type { Metrics } from "./metrics.js";

export type Job = {
  id: string;
  trigger: string;
  state: "queued" | "running" | "success" | "failure";
  startedAt?: string;
  finishedAt?: string;
  result?: unknown;
};

/** One queue owns complete operations, including reads and manual actions. */
export class JobRunner {
  private chain = Promise.resolve();
  private readonly keys = new Set<string>();
  private readonly jobs: Job[] = [];
  private stopping = false;

  constructor(
    private readonly metrics: Metrics,
    private readonly logger: Logger,
  ) {}

  get history(): readonly Job[] {
    return this.jobs;
  }
  get depth(): number {
    return this.keys.size;
  }

  enqueue(
    key: string,
    trigger: string,
    operation: () => Promise<unknown>,
  ): boolean {
    if (this.stopping || this.keys.has(key) || this.keys.size >= 32)
      return false;
    this.keys.add(key);
    const job: Job = { id: randomUUID(), trigger, state: "queued" };
    this.jobs.unshift(job);
    this.metrics.queueDepth.set(this.depth);
    this.chain = this.chain.then(async () => {
      job.state = "running";
      job.startedAt = new Date().toISOString();
      const stopTimer = this.metrics.jobDuration.startTimer({ trigger });
      try {
        job.result = await operation();
        job.state = hasFailures(job.result) ? "failure" : "success";
      } catch {
        job.state = "failure";
        this.logger.error(
          { trigger },
          "Operation failed; check credentials, mappings and connectivity",
        );
      } finally {
        stopTimer();
        job.finishedAt = new Date().toISOString();
        this.metrics.jobs.inc({ outcome: job.state, trigger });
        if (job.state === "success")
          this.metrics.lastSuccess.set({ trigger }, Date.now() / 1000);
        this.keys.delete(key);
        this.metrics.queueDepth.set(this.depth);
        const completed = this.jobs.filter((entry) => entry.finishedAt);
        for (const old of completed.slice(20))
          this.jobs.splice(this.jobs.indexOf(old), 1);
      }
    });
    return true;
  }

  async drain(): Promise<void> {
    await this.chain;
  }
  async close(): Promise<void> {
    this.stopping = true;
    await this.drain();
  }
}

function hasFailures(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "failed" in value &&
    typeof value.failed === "number" &&
    value.failed > 0
  );
}
