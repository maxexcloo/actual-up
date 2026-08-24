import pino from "pino";
import { describe, expect, it } from "vitest";

import { createBridgeServer } from "../src/bridge.js";
import type {
  ActualAccount,
  ActualCategory,
  ActualClient,
  ActualImportResult,
  ActualImportTransaction,
  ActualPayee,
  ActualTransaction,
} from "../src/types.js";

const token = "bridge-test-token";
const logger = pino({ enabled: false });

describe("Actual bridge", () => {
  it("requires bearer authentication for Actual operations", async () => {
    const server = createBridgeServer(new FakeActual(), token, logger);
    const denied = await server.inject({ method: "GET", url: "/v1/accounts" });
    expect(denied.statusCode).toBe(401);

    const allowed = await server.inject({
      headers: { authorization: `Bearer ${token}` },
      method: "GET",
      url: "/v1/accounts",
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json()).toEqual([
      { id: "actual-account", name: "Everyday" },
    ]);
    await server.close();
  });

  it("rejects malformed writes without invoking Actual", async () => {
    const actual = new FakeActual();
    const server = createBridgeServer(actual, token, logger);
    const response = await server.inject({
      headers: { authorization: `Bearer ${token}` },
      method: "POST",
      payload: {
        accountId: "actual-account",
        transaction: { amount: "private" },
      },
      url: "/v1/transactions/import",
    });
    expect(response.statusCode).toBe(400);
    expect(actual.imports).toBe(0);
    await server.close();
  });

  it("serialises all Actual operations", async () => {
    const actual = new FakeActual();
    const server = createBridgeServer(actual, token, logger);
    await Promise.all([
      server.inject({
        headers: { authorization: `Bearer ${token}` },
        method: "POST",
        url: "/v1/sync",
      }),
      server.inject({
        headers: { authorization: `Bearer ${token}` },
        method: "GET",
        url: "/v1/accounts",
      }),
    ]);
    expect(actual.maximumActive).toBe(1);
    await server.close();
  });

  it("publishes operational metrics without authentication", async () => {
    const server = createBridgeServer(new FakeActual(), token, logger);
    await server.inject({
      headers: { authorization: `Bearer ${token}` },
      method: "GET",
      url: "/v1/accounts",
    });
    const response = await server.inject({ method: "GET", url: "/metrics" });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain(
      'actual_up_bridge_operations_total{operation="accounts",outcome="success"} 1',
    );
    expect(response.body).not.toContain("Everyday");
    await server.close();
  });
});

class FakeActual implements ActualClient {
  active = 0;
  imports = 0;
  maximumActive = 0;

  async close(): Promise<void> {}
  async deleteTransaction(_id: string): Promise<void> {}
  async getCategories(): Promise<ActualCategory[]> {
    return [];
  }
  async getPayees(): Promise<ActualPayee[]> {
    return [];
  }
  async getServerVersion(): Promise<string> {
    return "26.8.1";
  }
  async getTransactions(
    _accountId: string,
    _startDate: string,
    _endDate: string,
  ): Promise<ActualTransaction[]> {
    return [];
  }
  async importTransaction(
    _accountId: string,
    _transaction: ActualImportTransaction,
  ): Promise<ActualImportResult> {
    this.imports += 1;
    return { added: [], errors: [], updated: [] };
  }
  async open(): Promise<void> {}
  async sync(): Promise<void> {
    await this.track(async () => undefined);
  }
  async updateTransaction(
    _id: string,
    _fields: Partial<ActualTransaction>,
  ): Promise<void> {}

  async getAccounts(): Promise<ActualAccount[]> {
    return this.track(async () => [{ id: "actual-account", name: "Everyday" }]);
  }

  private async track<T>(operation: () => Promise<T>): Promise<T> {
    this.active += 1;
    this.maximumActive = Math.max(this.maximumActive, this.active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    try {
      return await operation();
    } finally {
      this.active -= 1;
    }
  }
}
