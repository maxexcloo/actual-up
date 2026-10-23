import { mkdir } from "node:fs/promises";

import * as api from "@actual-app/api";

import { assertActualCompatibility } from "./actual-version.js";
import type { AppConfig } from "./config.js";
import { ConfigError } from "./errors.js";
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
      serverURL: this.config.serverUrl,
      verbose: false,
    };
    const credentials = this.app.secrets.actual;
    const { syncId } = this.config;
    if (!credentials || !syncId) throw new ConfigError("Configure Actual in the app first");
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
    if ("error" in result) throw new Error(`Actual server check failed: ${result.error}`);
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

  async importTransactions(
    accountId: string,
    transactions: ActualImportTransaction[],
  ): Promise<ActualImportResult> {
    await this.open();
    // Each transaction sets its own cleared state, so Actual's default does not apply.
    const result = await api.importTransactions(accountId, transactions, {
      reimportDeleted: false,
    });
    return {
      added: result.added,
      errors: result.errors,
      updated: result.updated,
    };
  }

  async updateTransaction(id: string, fields: Partial<ActualTransaction>): Promise<void> {
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
