import { Worker } from "node:worker_threads";
import { environmentValue, type AppConfig } from "./config.js";
import { getActualCredentials } from "./settings-store.js";
import type {
  ActualClient,
  ActualImportTransaction,
  ActualTransaction,
} from "./types.js";

export { assertActualCompatibility } from "./actual-version.js";

/** One worker owns Actual's synchronous database work; the web thread stays responsive. */
export class ActualBudgetClient implements ActualClient {
  private worker?: Worker;
  private nextId = 0;
  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();

  constructor(
    private readonly app: AppConfig,
    private readonly workerUrl = new URL("./actual-worker.js", import.meta.url),
  ) {}

  private getWorker(): Worker {
    if (this.worker) return this.worker;
    const credentials = getActualCredentials(this.app);
    const syncId =
      this.app.actual.syncId ??
      (this.app.actual.syncIdEnv
        ? environmentValue(this.app.actual.syncIdEnv)
        : undefined);
    if (!credentials || !syncId)
      throw new Error("Configure Actual in the app first");
    const worker = new Worker(this.workerUrl, {
      stderr: true,
      stdout: true,
      workerData: {
        credentials,
        config: { ...this.app, actual: { ...this.app.actual, syncId } },
      },
    });
    // SDK output can contain bank data. Only the app emits sanitised diagnostics.
    worker.stdout.resume();
    worker.stderr.resume();
    this.worker = worker;
    worker.on(
      "message",
      (message: { id: number; ok: boolean; value?: unknown }) => {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.ok) pending.resolve(message.value);
        else pending.reject(new Error("Actual operation failed"));
      },
    );
    const failed = () => {
      if (this.worker !== worker) return;
      this.worker = undefined;
      for (const pending of this.pending.values())
        pending.reject(new Error("Actual worker stopped"));
      this.pending.clear();
    };
    worker.on("error", failed);
    worker.on("exit", failed);
    return worker;
  }

  private call<K extends keyof ActualClient>(
    method: K,
    ...args: Parameters<ActualClient[K]>
  ): Promise<Awaited<ReturnType<ActualClient[K]>>> {
    const id = ++this.nextId;
    return new Promise<Awaited<ReturnType<ActualClient[K]>>>(
      (resolve, reject) => {
        const worker = this.getWorker();
        this.pending.set(id, {
          resolve: (value) =>
            resolve(value as Awaited<ReturnType<ActualClient[K]>>),
          reject,
        });
        try {
          worker.postMessage({ args, id, method });
        } catch {
          this.pending.delete(id);
          reject(new Error("Actual operation could not be queued"));
        }
      },
    );
  }

  open() {
    return this.call("open");
  }
  async close(): Promise<void> {
    const worker = this.worker;
    if (!worker) return;
    try {
      await this.call("close");
    } finally {
      await worker.terminate();
    }
  }
  getServerVersion() {
    return this.call("getServerVersion");
  }
  getAccounts() {
    return this.call("getAccounts");
  }
  getCategories() {
    return this.call("getCategories");
  }
  getPayees() {
    return this.call("getPayees");
  }
  getTransactions(accountId: string, startDate: string, endDate: string) {
    return this.call("getTransactions", accountId, startDate, endDate);
  }
  importTransaction(accountId: string, transaction: ActualImportTransaction) {
    return this.call("importTransaction", accountId, transaction);
  }
  updateTransaction(id: string, fields: Partial<ActualTransaction>) {
    return this.call("updateTransaction", id, fields);
  }
  deleteTransaction(id: string) {
    return this.call("deleteTransaction", id);
  }
  sync() {
    return this.call("sync");
  }
}
