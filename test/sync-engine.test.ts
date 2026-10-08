import pino from "pino";
import { describe, expect, it, vi } from "vitest";

import type { Alert, AlertSink } from "../src/alerts.js";
import { parseConfig, type AppConfig } from "../src/config.js";
import { Metrics } from "../src/metrics.js";
import {
  SyncEngine,
  actualDate,
  convertTransaction,
  isSafeToDelete,
} from "../src/sync-engine.js";
import type {
  ActualAccount,
  ActualCategory,
  ActualClient,
  ActualImportResult,
  ActualImportTransaction,
  ActualPayee,
  ActualTransaction,
  UpAccount,
  UpClientLike,
  UpTransaction,
  UpWebhook,
} from "../src/types.js";

const upAccountId = "11111111-1111-4111-8111-111111111111";

function config(overrides: Partial<AppConfig> = {}): AppConfig {
  const value = parseConfig({
    version: 1,
    actual: {
      passwordEnv: "ACTUAL_PASSWORD",
      serverUrl: "https://actual.example.com",
      syncId: "budget-id",
    },
    categoryMappings: { dining: "actual-food" },
    mappings: [
      {
        actualAccountId: "actual-spending",
        alias: "joint-spending",
        connections: ["first", "second"],
        upAccountId,
      },
    ],
    up: {
      connections: [
        { id: "first", tokenEnv: "UP_TOKEN_FIRST" },
        { id: "second", tokenEnv: "UP_TOKEN_SECOND" },
      ],
    },
  });
  return { ...value, ...overrides };
}

function transaction(status: "HELD" | "SETTLED" = "HELD"): UpTransaction {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    attributes: {
      amount: { currencyCode: "AUD", value: "-12.50", valueInBaseUnits: -1250 },
      createdAt: "2026-08-19T23:30:00Z",
      description: "Dinner",
      message: "shared meal",
      performingCustomer: { displayName: "Max" },
      rawText: "DINNER PLACE 123",
      settledAt: status === "SETTLED" ? "2026-08-21T01:00:00Z" : null,
      status,
    },
    relationships: {
      account: { data: { id: upAccountId, type: "accounts" } },
      category: { data: { id: "dining", type: "categories" } },
      transferAccount: { data: null },
    },
  };
}

class MemoryActual implements ActualClient {
  accounts: ActualAccount[] = [{ id: "actual-spending", name: "Spending" }];
  categories: ActualCategory[] = [{ id: "actual-food", name: "Food" }];
  payees: ActualPayee[] = [];
  transactions: ActualTransaction[] = [];
  syncs = 0;

  async open() {}
  async close() {}
  async getServerVersion() {
    return "26.8.1";
  }
  async getAccounts() {
    return this.accounts;
  }
  async getCategories() {
    return this.categories;
  }
  async getPayees() {
    return this.payees;
  }
  async getTransactions(accountId: string) {
    return this.transactions.filter(({ account }) => account === accountId);
  }
  async importTransaction(
    _accountId: string,
    value: ActualImportTransaction,
  ): Promise<ActualImportResult> {
    const existing = this.transactions.find(
      ({ imported_id }) => imported_id === value.imported_id,
    );
    if (existing) {
      existing.amount = value.amount;
      existing.cleared = value.cleared;
      existing.date = value.date;
      return { added: [], errors: [], updated: [existing.id] };
    }
    this.transactions.push({
      ...value,
      id: `actual-${this.transactions.length + 1}`,
      payee: null,
    });
    return { added: [this.transactions.at(-1)!.id], errors: [], updated: [] };
  }
  async updateTransaction(id: string, fields: Partial<ActualTransaction>) {
    Object.assign(
      this.transactions.find((value) => value.id === id)!,
      fields,
    );
  }
  async deleteTransaction(id: string) {
    this.transactions = this.transactions.filter((value) => value.id !== id);
  }
  async sync() {
    this.syncs += 1;
  }
}

class StubUp implements UpClientLike {
  constructor(
    readonly transactions: UpTransaction[],
    readonly fails = false,
  ) {}
  async ping() {}
  async listAccounts(): Promise<UpAccount[]> {
    if (this.fails) throw new Error("unavailable");
    return [
      {
        id: upAccountId,
        attributes: {
          accountType: "TRANSACTIONAL",
          balance: { currencyCode: "AUD", value: "0.00", valueInBaseUnits: 0 },
          displayName: "2Up",
          ownershipType: "JOINT",
        },
      },
    ];
  }
  async listTransactions(accountId: string) {
    if (this.fails) throw new Error("unavailable");
    return this.transactions.filter(
      (value) => value.relationships.account.data.id === accountId,
    );
  }
  async getTransaction() {
    return this.transactions[0]!;
  }
  async createWebhook(): Promise<UpWebhook> {
    throw new Error("not used");
  }
  async deleteWebhook() {}
  async listWebhooks(): Promise<UpWebhook[]> {
    return [];
  }
  async pingWebhook() {}
}

class MemoryAlerts implements AlertSink {
  values: Alert[] = [];
  async send(alert: Alert) {
    this.values.push(alert);
  }
}

function engine(
  actual: MemoryActual,
  first: StubUp,
  second = new StubUp([]),
  alerts = new MemoryAlerts(),
) {
  return {
    alerts,
    value: new SyncEngine(
      config(),
      actual,
      new Map([
        ["first", first],
        ["second", second],
      ]),
      alerts,
      new Metrics(),
      pino({ level: "silent" }),
    ),
  };
}

describe("sync engine", () => {
  it("falls back between joint-account tokens and remains idempotent", async () => {
    const actual = new MemoryActual();
    const { value } = engine(
      actual,
      new StubUp([], true),
      new StubUp([transaction()]),
    );
    expect((await value.reconcile()).imported).toBe(1);
    expect((await value.reconcile()).updated).toBe(1);
    expect(actual.transactions).toHaveLength(1);
    expect(actual.transactions[0]?.imported_id).toContain("22222222");
  });

  it("validates shared accounts when one partner's key is unavailable", async () => {
    for (const firstFails of [true, false]) {
      const { value } = engine(
        new MemoryActual(),
        new StubUp([], firstFails),
        new StubUp([], !firstFails),
      );
      await expect(value.validate()).resolves.toHaveProperty("actualVersion");
    }
  });

  it("imports personal and shared accounts once across multiple API keys", async () => {
    const actual = new MemoryActual();
    const personalId = "33333333-3333-4333-8333-333333333333";
    const personal = transaction();
    personal.id = "44444444-4444-4444-8444-444444444444";
    personal.relationships.account.data.id = personalId;
    const first = new StubUp([transaction(), personal]);
    const second = new StubUp([transaction()]);
    const sharedFetch = vi.spyOn(second, "listTransactions");
    const app = config();
    app.mappings.push({
      alias: "personal",
      upAccountId: personalId,
      actualAccountId: "actual-personal",
      connections: ["first"],
    });
    const value = new SyncEngine(
      app,
      actual,
      new Map([
        ["first", first],
        ["second", second],
      ]),
      new MemoryAlerts(),
      new Metrics(),
      pino({ enabled: false }),
    );
    expect((await value.reconcile({ since: "1970-01-01" })).imported).toBe(2);
    await value.reconcile({ since: "1970-01-01" });
    expect(actual.transactions).toHaveLength(2);
    expect(new Set(actual.transactions.map(({ account }) => account))).toEqual(
      new Set(["actual-spending", "actual-personal"]),
    );
    expect(sharedFetch).not.toHaveBeenCalled();
  });

  it("settles pending transactions without replacing Actual edits", async () => {
    const actual = new MemoryActual();
    const up = new StubUp([transaction()]);
    const { value } = engine(actual, up);
    await value.reconcile();
    actual.transactions[0]!.category = "custom-category";
    actual.transactions[0]!.notes = "household edit";
    up.transactions[0] = transaction("SETTLED");
    await value.reconcile();
    expect(actual.transactions[0]).toMatchObject({
      category: "custom-category",
      cleared: true,
      notes: "household edit",
    });
  });

  it("protects edited records when Up removes them", async () => {
    const actual = new MemoryActual();
    actual.transactions.push({
      account: "actual-spending",
      amount: -1250,
      category: "actual-food",
      cleared: true,
      date: "2026-08-20",
      id: "actual-1",
      imported_id: "up:gone",
    });
    const { alerts, value } = engine(actual, new StubUp([]));
    const report = await value.reconcile({ since: "2026-01-01" });
    expect(report.conflicts).toBe(1);
    expect(actual.transactions).toHaveLength(1);
    expect(alerts.values[0]?.type).toBe("delete-conflict");
  });

  it("applies a category mapping only after import leaves it empty", async () => {
    const actual = new MemoryActual();
    const { value } = engine(actual, new StubUp([transaction()]));
    await value.reconcile();
    expect(actual.transactions[0]?.category).toBe("actual-food");
  });
});

describe("transaction conversion", () => {
  it("uses Sydney dates and create-only joint-account context", () => {
    const converted = convertTransaction(
      transaction(),
      config().mappings[0]!,
      config(),
    );
    expect(converted).toMatchObject({
      amount: -1250,
      cleared: false,
      date: "2026-08-20",
      notes: "shared meal · Performed by Max",
    });
  });

  it("does not overwrite notes on subsequent imports", () => {
    const converted = convertTransaction(
      transaction("SETTLED"),
      config().mappings[0]!,
      config(),
      {
        account: "actual-spending",
        amount: -1250,
        date: "2026-08-20",
        id: "1",
      },
    );
    expect(converted.notes).toBeUndefined();
  });

  it("guards cleared edits but permits cancelled pending holds", () => {
    expect(
      isSafeToDelete({
        account: "a",
        amount: 1,
        category: "c",
        cleared: false,
        date: "2026-01-01",
        id: "1",
      }),
    ).toBe(true);
    expect(
      isSafeToDelete({
        account: "a",
        amount: 1,
        category: "c",
        cleared: true,
        date: "2026-01-01",
        id: "1",
      }),
    ).toBe(false);
  });

  it("formats an instant in the configured timezone", () => {
    expect(actualDate("2026-08-19T15:00:00Z", "Australia/Sydney")).toBe(
      "2026-08-20",
    );
  });
});
