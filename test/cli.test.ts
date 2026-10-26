import { afterEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  actual: { close: vi.fn(), sync: vi.fn() },
  engine: { reconcile: vi.fn() },
}));
vi.mock("../src/config.js", () => ({ loadConfig: vi.fn().mockResolvedValue({}) }));
vi.mock("../src/runtime.js", () => ({
  createRuntime: vi.fn().mockResolvedValue(runtime),
}));
vi.mock("../src/server.js", () => ({ startService: vi.fn() }));

const originalArgv = process.argv;
const originalExitCode = process.exitCode;
afterEach(() => {
  process.argv = originalArgv;
  process.exitCode = originalExitCode;
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("sync command", () => {
  it.each([
    { failed: 0, publication: "published", exitCode: 0 },
    { failed: 0, publication: "failed", exitCode: 1 },
    { failed: 1, publication: "published", exitCode: 1 },
    { failed: 0, publication: "not-required", exitCode: 0 },
  ])(
    "exits with $exitCode for $failed account failures and $publication publication",
    async ({ exitCode, ...report }) => {
      vi.resetModules();
      runtime.engine.reconcile.mockResolvedValue(report);
      const output = vi.spyOn(process.stdout, "write").mockReturnValue(true);
      process.argv = [process.execPath, "actual-up", "sync"];
      process.exitCode = 0;
      await import("../src/cli.js");
      await vi.waitFor(() => expect(runtime.actual.close).toHaveBeenCalledOnce());
      expect(process.exitCode).toBe(exitCode);
      expect(runtime.actual.sync.mock.invocationCallOrder[0]).toBeLessThan(
        runtime.engine.reconcile.mock.invocationCallOrder[0]!,
      );
      expect(JSON.parse(String(output.mock.calls[0]?.[0]))).toEqual(report);
    },
  );
});
