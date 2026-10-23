import { randomUUID } from "node:crypto";
import type { Logger } from "pino";

import { ConfigError } from "./errors.js";
import type { Metrics } from "./metrics.js";
import type { Job, JobProgress, JobScope } from "./api.js";
import type { SyncReport } from "./sync-engine.js";

export type { Job, JobProgress, JobScope } from "./api.js";

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
    operation: (progress: (value: JobProgress) => void) => Promise<unknown>,
    scope?: JobScope,
  ): boolean {
    if (this.stopping || this.keys.has(key) || this.keys.size >= 32) return false;
    this.keys.add(key);
    const job: Job = { id: randomUUID(), trigger, scope, state: "queued" };
    this.jobs.unshift(job);
    this.metrics.queueDepth.set(this.depth);
    this.chain = this.chain.then(async () => {
      job.state = "running";
      job.startedAt = new Date().toISOString();
      const stopTimer = this.metrics.jobDuration.startTimer({ trigger });
      try {
        job.result = await operation((value) => {
          job.progress = value;
        });
        const report = (job.result ?? {}) as Partial<SyncReport>;
        job.state =
          (report.failed ?? 0) > 0 || report.publication === "failed"
            ? "failure"
            : (report.conflicts ?? 0) > 0
              ? "warning"
              : "success";
      } catch (error) {
        job.state = "failure";
        // Upstream errors can contain bank data; only the app's own messages are logged.
        this.logger.error(
          error instanceof ConfigError ? { reason: error.message, trigger } : { trigger },
          "Operation failed; check credentials, mappings and connectivity",
        );
      } finally {
        stopTimer();
        job.finishedAt = new Date().toISOString();
        this.metrics.jobs.inc({ outcome: job.state, trigger });
        if (job.state === "success") this.metrics.lastSuccess.set({ trigger }, Date.now() / 1000);
        this.keys.delete(key);
        this.metrics.queueDepth.set(this.depth);
        const completed = this.jobs.filter((entry) => entry.finishedAt);
        for (const old of completed.slice(20)) this.jobs.splice(this.jobs.indexOf(old), 1);
      }
    });
    return true;
  }

  async drain(): Promise<void> {
    let pending;
    do {
      pending = this.chain;
      await pending;
    } while (pending !== this.chain);
  }
  async close(): Promise<void> {
    this.stopping = true;
    await this.drain();
  }
}
