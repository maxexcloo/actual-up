import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as api from "@actual-app/api";
import { ActualApiClient as ActualBudgetClient } from "../src/actual-api-client.js";
import { parseConfig } from "../src/config.js";
import { setActualCredentials } from "../src/settings-store.js";

vi.mock("@actual-app/api", () => ({
  init: vi.fn(),
  shutdown: vi.fn(),
  downloadBudget: vi.fn(),
  getServerVersion: vi.fn(),
  getAccounts: vi.fn(),
}));
const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { force: true, recursive: true });
  vi.resetAllMocks();
});
async function fixture() {
  const cacheDirectory = await mkdtemp(join(tmpdir(), "actual-up-cache-"));
  directories.push(cacheDirectory);
  vi.mocked(api.init).mockResolvedValue({} as never);
  vi.mocked(api.shutdown).mockResolvedValue(undefined);
  vi.mocked(api.getServerVersion).mockResolvedValue({ version: "26.10.0" });
  const config = parseConfig({
    version: 1,
    actual: { cacheDirectory, serverUrl: "http://actual", syncId: "budget" },
    up: { connections: [] },
  });
  return { config, client: new ActualBudgetClient(config) };
}
describe("Actual connection lifecycle", () => {
  it("waits for browser setup, opens lazily and reconnects with changed credentials", async () => {
    const { config, client } = await fixture();
    expect(api.init).not.toHaveBeenCalled();
    await expect(client.open()).rejects.toThrow("Configure Actual");
    setActualCredentials(config, {
      credential: "first-secret",
      method: "session",
    });
    await client.getAccounts();
    expect(api.init).toHaveBeenCalledWith(
      expect.objectContaining({ sessionToken: "first-secret", verbose: false }),
    );
    await client.getAccounts();
    expect(api.init).toHaveBeenCalledTimes(1);
    await client.close();
    setActualCredentials(config, {
      credential: "replacement",
      encryptionPassword: "budget-encryption",
      method: "password",
    });
    await client.open();
    expect(api.init).toHaveBeenLastCalledWith(
      expect.objectContaining({ password: "replacement" }),
    );
    expect(api.downloadBudget).toHaveBeenLastCalledWith("budget", {
      password: "budget-encryption",
    });
  });
  it("cleans up failed connections and refuses incompatible servers before downloading", async () => {
    const { config, client } = await fixture();
    setActualCredentials(config, { credential: "secret", method: "session" });
    vi.mocked(api.getServerVersion).mockResolvedValueOnce({
      version: "25.1.0",
    });
    await expect(client.open()).rejects.toThrow("incompatible");
    expect(api.shutdown).toHaveBeenCalledTimes(1);
    expect(api.downloadBudget).not.toHaveBeenCalled();
    await client.open();
    expect(api.downloadBudget).toHaveBeenCalledTimes(1);
  });
});
