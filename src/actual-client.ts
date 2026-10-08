import { mkdir } from "node:fs/promises";

import * as api from "@actual-app/api";

import { environmentValue, type AppConfig } from "./config.js";
import type {
  ActualAccount,
  ActualCategory,
  ActualClient,
  ActualImportResult,
  ActualImportTransaction,
  ActualPayee,
  ActualTransaction,
} from "./types.js";

export class ActualBudgetClient implements ActualClient {
  private opened = false;

  constructor(private readonly config: AppConfig["actual"]) {}

  async open(): Promise<void> {
    if (this.opened) return;
    await mkdir(this.config.cacheDirectory, { recursive: true });
    const base = {
      dataDir: this.config.cacheDirectory,
      serverURL: this.config.serverUrl,
    };
    if (this.config.passwordEnv) {
      await api.init({
        ...base,
        password: environmentValue(this.config.passwordEnv),
      });
    } else {
      await api.init({
        ...base,
        sessionToken: environmentValue(this.config.sessionTokenEnv!),
      });
    }
    await api.downloadBudget(
      this.config.syncId ?? environmentValue(this.config.syncIdEnv!),
      {
        password: this.config.encryptionPasswordEnv
          ? environmentValue(this.config.encryptionPasswordEnv)
          : undefined,
      },
    );
    this.opened = true;
  }

  async close(): Promise<void> {
    if (!this.opened) return;
    await api.shutdown();
    this.opened = false;
  }

  async getServerVersion(): Promise<string> {
    const result = await api.getServerVersion();
    if ("error" in result)
      throw new Error(`Actual server check failed: ${result.error}`);
    return result.version;
  }

  async getAccounts(): Promise<ActualAccount[]> {
    return api.getAccounts();
  }

  async getCategories(): Promise<ActualCategory[]> {
    return api.getCategories();
  }

  async getPayees(): Promise<ActualPayee[]> {
    return api.getPayees();
  }

  async getTransactions(
    accountId: string,
    startDate: string,
    endDate: string,
  ): Promise<ActualTransaction[]> {
    return api.getTransactions(accountId, startDate, endDate);
  }

  async importTransaction(
    accountId: string,
    transaction: ActualImportTransaction,
  ): Promise<ActualImportResult> {
    const result = await api.importTransactions(accountId, [transaction], {
      defaultCleared: transaction.cleared,
      reimportDeleted: false,
    });
    return {
      added: result.added,
      errors: result.errors,
      updated: result.updated,
    };
  }

  async updateTransaction(
    id: string,
    fields: Partial<ActualTransaction>,
  ): Promise<void> {
    await api.updateTransaction(id, fields);
  }

  async deleteTransaction(id: string): Promise<void> {
    await api.deleteTransaction(id);
  }

  async sync(): Promise<void> {
    await api.sync();
  }
}
