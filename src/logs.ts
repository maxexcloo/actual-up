import { Writable } from "node:stream";

import type { LogEntry } from "./api.js";

const levels: Record<number, LogEntry["level"]> = {
  20: "debug",
  30: "info",
  40: "warn",
  50: "error",
  60: "error",
};
// The app logs no bank data, but only these fields are shown in the browser.
const contextFields = ["account", "connection", "trigger", "reason", "status", "attempt"];

/** Keep the latest log lines in memory for the browser; they reset on restart. */
export class LogBuffer extends Writable {
  readonly entries: LogEntry[] = [];

  override _write(chunk: Buffer, _encoding: string, callback: () => void): void {
    const line = JSON.parse(chunk.toString("utf8")) as Record<string, unknown>;
    const context = contextFields
      .filter((key) => line[key] !== undefined)
      .map((key) => `${key}=${String(line[key])}`)
      .join(" ");
    this.entries.unshift({
      time: new Date(Number(line.time)).toISOString(),
      level: levels[Number(line.level)] ?? "info",
      message: String(line.msg ?? ""),
      ...(context && { context }),
    });
    this.entries.splice(200);
    callback();
  }
}
