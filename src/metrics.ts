import {
  Counter,
  Gauge,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from "prom-client";

export class Metrics {
  readonly registry = new Registry();
  readonly jobs = new Counter({
    help: "Completed sync jobs by trigger and outcome.",
    name: "actual_up_jobs_total",
    labelNames: ["outcome", "trigger"],
    registers: [this.registry],
  });
  readonly jobDuration = new Histogram({
    help: "Sync job duration in seconds.",
    name: "actual_up_job_duration_seconds",
    labelNames: ["trigger"],
    registers: [this.registry],
  });
  readonly lastSuccess = new Gauge({
    help: "Unix timestamp of the last successful sync.",
    name: "actual_up_last_success_timestamp_seconds",
    labelNames: ["trigger"],
    registers: [this.registry],
  });
  readonly transactions = new Counter({
    help: "Transactions considered by action and account alias.",
    name: "actual_up_transactions_total",
    labelNames: ["account", "action"],
    registers: [this.registry],
  });
  readonly queueDepth = new Gauge({
    help: "Number of queued sync jobs.",
    name: "actual_up_queue_depth",
    registers: [this.registry],
  });

  constructor() {
    collectDefaultMetrics({
      prefix: "actual_up_process_",
      register: this.registry,
    });
  }
}
