import pino from "pino";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { parseConfig, type AppConfig } from "../src/config.js";
import { Metrics } from "../src/metrics.js";
import { SyncEngine, actualDate, convertTransaction, isSafeToDelete } from "../src/sync-engine.js";
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
} from "../src/types.js";

const upAccountId = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-08-22T12:00:00Z"));
});
afterEach(() => vi.restoreAllMocks());

function config(overrides: Partial<AppConfig> = {}): AppConfig {
  const value = parseConfig({
    version: 1,
    actual: {
      serverUrl: "https://actual.example.com",
      syncId: "budget-id",
    },
    categoryMappings: { dining: "actual-food" },
    mappings: [
      {
        actualAccountId: "actual-spending",
        alias: "joint-spending",
        upAccountId,
        connections: ["first", "second"],
      },
    ],
    up: {
      connections: [{ id: "first" }, { id: "second" }],
    },
  });
  return { ...value, ...overrides };
}

function transaction(status: "HELD" | "SETTLED" = "HELD"): UpTransaction {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    attributes: {
      createdAt: "2026-08-19T23:30:00Z",
      description: "Dinner",
      message: "shared meal",
      rawText: "DINNER PLACE 123",
      settledAt: status === "SETTLED" ? "2026-08-21T01:00:00Z" : null,
      status,
      amount: { currencyCode: "AUD", value: "-12.50", valueInBaseUnits: -1250 },
      performingCustomer: { displayName: "Max" },
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
  async getTransactions(accountId: string, startDate: string, endDate: string) {
    return structuredClone(
      this.transactions.filter(
        ({ account, date }) => account === accountId && date >= startDate && date <= endDate,
      ),
    );
  }
  async importTransactions(
    _accountId: string,
    values: ActualImportTransaction[],
  ): Promise<ActualImportResult> {
    const result: ActualImportResult = { added: [], errors: [], updated: [] };
    for (const value of values) {
      const existing = this.transactions.find(
        ({ imported_id }) => imported_id === value.imported_id,
      );
      if (existing) {
        existing.amount = value.amount;
        existing.cleared = value.cleared;
        existing.date = value.date;
        result.updated.push(existing.id);
        continue;
      }
      this.transactions.push({
        ...value,
        id: `actual-${this.transactions.length + 1}`,
        payee: null,
      });
      result.added.push(this.transactions.at(-1)!.id);
    }
    return result;
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
          displayName: "2Up",
          ownershipType: "JOINT",
          balance: { currencyCode: "AUD", value: "0.00", valueInBaseUnits: 0 },
        },
      },
    ];
  }
  async listTransactions(accountId: string, since: string) {
    if (this.fails) throw new Error("unavailable");
    return this.transactions.filter(
      (value) =>
        value.relationships.account.data.id === accountId &&
        Date.parse(value.attributes.createdAt) >= Date.parse(since),
    );
  }
}

function engine(actual: MemoryActual, first: StubUp, second = new StubUp([])) {
  return {
    value: new SyncEngine(
      config(),
      actual,
      new Map([
        ["first", first],
        ["second", second],
      ]),
      new Metrics(),
      pino({ level: "silent" }),
    ),
  };
}

describe("sync engine", () => {
  it("falls back between joint-account tokens and remains idempotent", async () => {
    const actual = new MemoryActual();
    const { value } = engine(actual, new StubUp([], true), new StubUp([transaction()]));
    expect((await value.reconcile()).imported).toBe(1);
    expect((await value.reconcile()).updated).toBe(1);
    expect(actual.transactions).toHaveLength(1);
    expect(actual.transactions[0]?.imported_id).toContain("22222222");
  });

  it("previews unchanged bank fields without counting protected Actual edits as updates", async () => {
    const actual = new MemoryActual();
    const up = new StubUp([transaction()]);
    const { value } = engine(actual, up);
    await value.reconcile();
    actual.transactions[0]!.notes = "edited locally";
    actual.transactions[0]!.category = "household";
    const write = vi.spyOn(actual, "importTransactions");
    const preview = await value.reconcile({ dryRun: true });
    expect(preview).toMatchObject({
      imported: 0,
      updated: 0,
      unchanged: 1,
      preview: true,
      publication: "not-required",
    });
    expect(write).not.toHaveBeenCalled();
    up.transactions[0] = transaction("SETTLED");
    expect(await value.reconcile({ dryRun: true })).toMatchObject({
      updated: 1,
      unchanged: 0,
    });
    expect(actual.transactions[0]!.cleared).toBe(false);
  });

  it("publishes partial imports, and identifies the failed account safely", async () => {
    const actual = new MemoryActual();
    const app = config();
    app.mappings.push({
      actualAccountId: "other",
      alias: "other",
      upAccountId: "33333333-3333-4333-8333-333333333333",
      connections: ["missing"],
    });
    const value = new SyncEngine(
      app,
      actual,
      new Map([["first", new StubUp([transaction()])]]),
      new Metrics(),
      pino({ enabled: false }),
    );
    const progress = vi.fn();
    const result = await value.reconcile({ progress });
    expect(result).toMatchObject({
      imported: 1,
      failed: 1,
      publication: "published",
    });
    expect(result.accounts[1]).toMatchObject({
      account: "other",
      failed: 1,
      issue: "up-unavailable",
    });
    expect(actual.syncs).toBe(1);
    expect(JSON.stringify(result)).not.toContain("sensitive");
    expect(progress).toHaveBeenLastCalledWith({
      completed: 2,
      stage: "Publish to Actual",
      total: 2,
    });
  });

  it("retains account results when publishing fails", async () => {
    const actual = new MemoryActual();
    vi.spyOn(actual, "sync").mockRejectedValue(new Error("sensitive response"));
    const { value } = engine(actual, new StubUp([transaction()]));
    expect(await value.reconcile()).toMatchObject({
      imported: 1,
      publication: "failed",
      accounts: [expect.objectContaining({ account: "joint-spending", imported: 1 })],
    });
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
      actualAccountId: "actual-personal",
      alias: "personal",
      upAccountId: personalId,
      connections: ["first"],
    });
    const value = new SyncEngine(
      app,
      actual,
      new Map([
        ["first", first],
        ["second", second],
      ]),
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
    const { value } = engine(actual, new StubUp([]));
    const report = await value.reconcile({ since: "1970-01-01" });
    expect(report.conflicts).toBe(1);
    expect(actual.transactions).toHaveLength(1);
  });

  it("applies a category mapping only after import leaves it empty", async () => {
    const actual = new MemoryActual();
    const { value } = engine(actual, new StubUp([transaction()]));
    await value.reconcile();
    expect(actual.transactions[0]?.category).toBe("actual-food");
  });

  it.each([false, true])(
    "retains transactions excluded by partial Up windows (preview: %s)",
    async (dryRun) => {
      const actual = new MemoryActual();
      const up = new StubUp([transaction("SETTLED")]);
      const { value } = engine(actual, up);
      await value.reconcile({ since: "1970-01-01" });
      // A hold is deletable even with notes or a category, so deletion guards cannot hide the bug.
      actual.transactions[0]!.cleared = false;
      for (const since of ["2026-08-20T03:00:00Z", "2026-08-21"]) {
        const report = await value.reconcile({ dryRun, since });
        expect(report).toMatchObject({ conflicts: 0, deleted: 0, failed: 0, inspected: 0 });
        expect(actual.transactions).toHaveLength(1);
      }
    },
  );

  it.each([false, true])(
    "handles confirmed full-history absence safely (preview: %s)",
    async (dryRun) => {
      const actual = new MemoryActual();
      actual.transactions.push({
        account: "actual-spending",
        amount: -1250,
        cleared: false,
        date: "2026-08-20",
        id: "cancelled",
        imported_id: "up:cancelled",
      });
      const { value } = engine(actual, new StubUp([]));
      expect(await value.reconcile({ dryRun, since: "1970-01-01" })).toMatchObject({
        conflicts: 0,
        deleted: 1,
        failed: 0,
      });
      expect(actual.transactions).toHaveLength(dryRun ? 1 : 0);
    },
  );

  it("reads account history a constant number of times and preserves import-rule categories", async () => {
    const actual = new MemoryActual();
    const transactions = Array.from({ length: 100 }, (_, index) => ({
      ...transaction(),
      id: `bank-${index}`,
    }));
    const { value } = engine(actual, new StubUp(transactions));
    const originalImport = actual.importTransactions.bind(actual);
    const write = vi
      .spyOn(actual, "importTransactions")
      .mockImplementation(async (account, converted) => {
        const result = await originalImport(account, converted);
        actual.transactions[0]!.category = "rule-category";
        actual.transactions[0]!.date = "2026-01-01";
        return result;
      });
    const read = vi.spyOn(actual, "getTransactions");
    expect(await value.reconcile({ since: "1970-01-01" })).toMatchObject({
      failed: 0,
      imported: 100,
    });
    expect(read).toHaveBeenCalledTimes(2);
    expect(write).toHaveBeenCalledTimes(1);
    expect(actual.transactions[0]?.category).toBe("rule-category");
    expect(actual.transactions.slice(1).every(({ category }) => category === "actual-food")).toBe(
      true,
    );

    read.mockClear();
    vi.mocked(actual.importTransactions).mockResolvedValue({ added: [], errors: [], updated: [] });
    expect(await value.reconcile({ since: "1970-01-01" })).toMatchObject({
      failed: 0,
      unchanged: 100,
    });
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("preserves categories for mapped transfers and applies category mappings once no longer a transfer", async () => {
    const actual = new MemoryActual();
    const transfer = transaction();
    transfer.relationships.transferAccount = { data: { id: upAccountId, type: "accounts" } };
    actual.payees.push({
      id: "transfer-payee",
      name: "Spending",
      transfer_acct: "actual-spending",
    });
    const up = new StubUp([transfer]);
    const { value } = engine(actual, up);
    await value.reconcile({ since: "1970-01-01" });
    expect(actual.transactions[0]?.category).toBeUndefined();
    up.transactions[0] = transaction();
    await value.reconcile({ since: "1970-01-01" });
    expect(actual.transactions[0]?.category).toBe("actual-food");
  });
});

describe("transaction conversion", () => {
  it("uses Sydney dates and create-only joint-account context", () => {
    const converted = convertTransaction(transaction(), config().mappings[0]!, config());
    expect(converted).toMatchObject({
      amount: -1250,
      cleared: false,
      date: "2026-08-20",
      notes: "shared meal · Performed by Max",
    });
  });

  it("does not overwrite notes on subsequent imports", () => {
    const converted = convertTransaction(transaction("SETTLED"), config().mappings[0]!, config(), {
      account: "actual-spending",
      amount: -1250,
      date: "2026-08-20",
      id: "1",
    });
    expect(converted.notes).toBeUndefined();
  });

  it("protects edited transactions whether pending or cleared", () => {
    expect(
      isSafeToDelete({
        account: "a",
        amount: 1,
        category: "c",
        cleared: false,
        date: "2026-01-01",
        id: "1",
      }),
    ).toBe(false);
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

  it.each([
    [{}, true],
    [{ notes: "kept" }, false],
    [{ category: "category" }, false],
    [{ reconciled: true }, false],
  ])("preserves pending hold edits %j", (edits, deletable) => {
    expect(
      isSafeToDelete({
        account: "a",
        amount: 1,
        cleared: false,
        date: "2026-01-01",
        id: "1",
        ...edits,
      }),
    ).toBe(deletable);
  });

  it("formats an instant in the configured timezone", () => {
    expect(actualDate("2026-08-19T15:00:00Z", "Australia/Sydney")).toBe("2026-08-20");
  });
});
