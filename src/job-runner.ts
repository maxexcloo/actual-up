import type { Logger } from "pino";

import type { Metrics } from "./metrics.js";

export class JobRunner {
  private chain = Promise.resolve();
  private readonly keys = new Set<string>();
  private queued = 0;

  constructor(
    private readonly metrics: Metrics,
    private readonly logger: Logger,
  ) {}

  enqueue(key: string, trigger: string, job: () => Promise<unknown>): boolean {
    if (this.keys.has(key)) return false;
    this.keys.add(key);
    this.queued += 1;
    this.metrics.queueDepth.set(this.queued);
    this.chain = this.chain
      .then(async () => {
        const stopTimer = this.metrics.jobDuration.startTimer({ trigger });
        try {
          await job();
          this.metrics.jobs.inc({ outcome: "success", trigger });
          this.metrics.lastSuccess.set({ trigger }, Date.now() / 1000);
        } catch (error) {
          this.metrics.jobs.inc({ outcome: "failure", trigger });
          this.logger.error({ err: error, trigger }, "Sync job failed");
        } finally {
          stopTimer();
          this.keys.delete(key);
          this.queued -= 1;
          this.metrics.queueDepth.set(this.queued);
        }
      })
      .catch((error: unknown) =>
        this.logger.error({ err: error }, "Job queue failed"),
      );
    return true;
  }

  async drain(): Promise<void> {
    await this.chain;
  }
}
