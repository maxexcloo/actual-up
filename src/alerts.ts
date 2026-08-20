import type { Logger } from "pino";

import { environmentValue, type AppConfig } from "./config.js";

export type Alert = {
  account?: string;
  detail: string;
  severity: "error" | "warning";
  type: string;
};

export interface AlertSink {
  send(alert: Alert): Promise<void>;
}

export class WebhookAlertSink implements AlertSink {
  private readonly lastSent = new Map<string, number>();

  constructor(
    private readonly config: NonNullable<AppConfig["alerts"]>,
    private readonly logger: Logger,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async send(alert: Alert): Promise<void> {
    const key = `${alert.type}:${alert.account ?? "global"}`;
    const now = Date.now();
    const cooldown = this.config.cooldownMinutes * 60_000;
    if (now - (this.lastSent.get(key) ?? 0) < cooldown) return;

    const response = await this.fetcher(environmentValue(this.config.urlEnv), {
      body: JSON.stringify({
        ...alert,
        source: "actual-up",
        timestamp: new Date().toISOString(),
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      this.logger.warn(
        { alertType: alert.type, status: response.status },
        "Alert webhook failed",
      );
      return;
    }
    this.lastSent.set(key, now);
  }
}

export class LoggingAlertSink implements AlertSink {
  constructor(private readonly logger: Logger) {}

  async send(alert: Alert): Promise<void> {
    this.logger.warn(
      {
        account: alert.account,
        alertType: alert.type,
        severity: alert.severity,
      },
      alert.detail,
    );
  }
}
