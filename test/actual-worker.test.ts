import { describe, expect, it } from "vitest";
import { ActualBudgetClient } from "../src/actual-client.js";
import { parseConfig } from "../src/config.js";
import { setActualCredentials } from "../src/settings-store.js";

function fixture() {
  const config = parseConfig({
    version: 1,
    actual: { serverUrl: "http://actual", syncId: "budget" },
    up: { connections: [] },
  });
  const client = new ActualBudgetClient(
    config,
    new URL("./fixtures/actual-worker.mjs", import.meta.url),
  );
  return { config, client };
}

describe("Actual worker isolation", () => {
  it("keeps the parent responsive during synchronous database work and reconnects with new credentials", async () => {
    const { config, client } = fixture();
    await expect(client.open()).rejects.toThrow("Configure Actual");
    setActualCredentials(config, {
      method: "password",
      credential: "test-secret",
    });
    try {
      await client.open();
      let finished = false;
      const work = client.sync().then(() => {
        finished = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(finished).toBe(false);
      await work;
      expect(await client.getServerVersion()).toBe("password");
      await client.close();
      setActualCredentials(config, {
        method: "session",
        credential: "replacement-secret",
      });
      expect(await client.getServerVersion()).toBe("session");
    } finally {
      await client.close();
    }
  });
  it("rejects pending calls on worker failure, sanitises errors and permits a fresh connection", async () => {
    const { config, client } = fixture();
    setActualCredentials(config, {
      method: "password",
      credential: "test-secret",
    });
    try {
      await expect(client.getPayees()).rejects.toThrow(
        "Actual operation failed",
      );
      await expect(client.deleteTransaction("test-id")).rejects.toThrow(
        "Actual worker stopped",
      );
      expect(await client.getServerVersion()).toBe("password");
    } finally {
      await client.close();
    }
  });
});
