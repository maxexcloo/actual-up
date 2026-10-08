import { assertActualCompatibility } from "./actual-version.js";
import { getActualCredentials } from "./settings-store.js";
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

export class ActualApiClient implements ActualClient {
  private opened = false;

  constructor(private readonly app: AppConfig) {}

  private get config() {
    return this.app.actual;
  }

  async open(): Promise<void> {
    if (this.opened) return;
    await mkdir(this.config.cacheDirectory, { recursive: true });
    const base = {
      dataDir: this.config.cacheDirectory,
      verbose: false,
      serverURL: this.config.serverUrl,
    };
    const credentials = getActualCredentials(this.app);
    const syncId =
      this.config.syncId ??
      (this.config.syncIdEnv
        ? environmentValue(this.config.syncIdEnv)
        : undefined);
    if (!credentials || !syncId)
      throw new Error("Configure Actual in the app first");
    try {
      await api.init({
        ...base,
        ...(credentials.method === "password"
          ? { password: credentials.credential }
          : { sessionToken: credentials.credential }),
      });
      const version = await api.getServerVersion();
      if ("error" in version) throw new Error("Actual server check failed");
      assertActualCompatibility(version.version);
      await api.downloadBudget(syncId, {
        password: credentials.encryptionPassword,
      });
      this.opened = true;
    } catch (error) {
      await api.shutdown().catch(() => {});
      throw error;
    }
  }

  async close(): Promise<void> {
    if (!this.opened) return;
    await api.shutdown();
    this.opened = false;
  }

  async getServerVersion(): Promise<string> {
    await this.open();
    const result = await api.getServerVersion();
    if ("error" in result)
      throw new Error(`Actual server check failed: ${result.error}`);
    return result.version;
  }

  async getAccounts(): Promise<ActualAccount[]> {
    await this.open();
    return api.getAccounts();
  }

  async getCategories(): Promise<ActualCategory[]> {
    await this.open();
    return api.getCategories();
  }

  async getPayees(): Promise<ActualPayee[]> {
    await this.open();
    return api.getPayees();
  }

  async getTransactions(
    accountId: string,
    startDate: string,
    endDate: string,
  ): Promise<ActualTransaction[]> {
    await this.open();
    return api.getTransactions(accountId, startDate, endDate);
  }

  async importTransaction(
    accountId: string,
    transaction: ActualImportTransaction,
  ): Promise<ActualImportResult> {
    await this.open();
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
    await this.open();
    await api.updateTransaction(id, fields);
  }

  async deleteTransaction(id: string): Promise<void> {
    await this.open();
    await api.deleteTransaction(id);
  }

  async sync(): Promise<void> {
    await this.open();
    await api.sync();
  }
}
