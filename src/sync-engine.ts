import type { Logger } from "pino";

import type { AlertSink } from "./alerts.js";
import type { AccountMapping, AppConfig } from "./config.js";
import { ConfigError } from "./errors.js";
import type { JobProgress } from "./job-runner.js";
import type { Metrics } from "./metrics.js";
import type {
  ActualClient,
  ActualImportTransaction,
  ActualPayee,
  ActualTransaction,
  UpClientLike,
  UpTransaction,
} from "./types.js";

const IMPORT_PREFIX = "up:";
const END_DATE = "2999-12-31";
/** A `since` value that reads full history, which also proves deletions. */
export const HISTORY_START = "1970-01-01";

type Change = {
  converted: ActualImportTransaction;
  current?: ActualTransaction;
  transferPayee?: ActualPayee;
  up: UpTransaction;
};

type CategoryUpdate = {
  categoryId: string;
  importedId: string;
  unchanged: boolean;
};

export type SyncCounts = {
  conflicts: number;
  deleted: number;
  failed: number;
  imported: number;
  inspected: number;
  unchanged: number;
  updated: number;
};

export type SyncReport = SyncCounts & {
  accounts: Array<SyncCounts & { account: string; issue?: string }>;
  preview: boolean;
  publication: "not-required" | "pending" | "published" | "failed";
};

type SyncOptions = {
  dryRun?: boolean;
  mappingAliases?: string[];
  since?: string;
  progress?: (value: JobProgress) => void;
};

export class SyncEngine {
  constructor(
    private readonly config: AppConfig,
    private readonly actual: ActualClient,
    private readonly upClients: Map<string, UpClientLike>,
    private readonly alerts: AlertSink,
    private readonly metrics: Metrics,
    private readonly logger: Logger,
  ) {}

  async validate(): Promise<{ actualVersion: string }> {
    const accounts = await this.actual.getAccounts();
    const categories = await this.actual.getCategories();
    const actualVersion = await this.actual.getServerVersion();
    const accountIds = new Set(accounts.map(({ id }) => id));
    const categoryIds = new Set(categories.map(({ id }) => id));

    for (const mapping of this.config.mappings) {
      if (!accountIds.has(mapping.actualAccountId)) {
        throw new ConfigError(
          `Mapping ${mapping.alias} references missing Actual account ${mapping.actualAccountId}`,
        );
      }
      await this.withConnectionFallback(mapping, async (client) => {
        const accessible = (await client.listAccounts()).some(
          ({ id }) => id === mapping.upAccountId,
        );
        if (!accessible) throw new ConfigError("Connection cannot access the mapped Up account");
      });
    }

    for (const actualCategoryId of Object.values(this.config.categoryMappings)) {
      if (!categoryIds.has(actualCategoryId)) {
        throw new ConfigError(
          `Category mapping references missing Actual category ${actualCategoryId}`,
        );
      }
    }
    return { actualVersion };
  }

  async reconcile(options: SyncOptions = {}): Promise<SyncReport> {
    const report = emptyReport();
    const since = normaliseSince(
      options.since ?? lookbackTimestamp(this.config.schedule.lookbackDays),
    );
    const mappings = this.config.mappings.filter(
      ({ alias }) => !options.mappingAliases || options.mappingAliases.includes(alias),
    );
    report.preview = Boolean(options.dryRun);
    report.publication = options.dryRun ? "not-required" : "pending";
    let completed = 0;
    for (const mapping of mappings) {
      const accountReport = {
        ...emptyCounts(),
        account: mapping.alias,
        issue: undefined as string | undefined,
      };
      let stage = "Read Actual";
      const progress = (next: string) => {
        stage = next;
        options.progress?.({
          account: mapping.alias,
          completed,
          stage,
          total: mappings.length,
        });
      };
      try {
        progress("Read Actual");
        const transferPayees = await this.transferPayees();
        await this.reconcileMapping(
          mapping,
          since,
          transferPayees,
          accountReport,
          options.dryRun,
          progress,
        );
      } catch {
        accountReport.failed = 1;
        accountReport.issue =
          stage === "Read Up"
            ? "up-unavailable"
            : stage === "Read Actual"
              ? "actual-unavailable"
              : "actual-write-failed";
        this.logger.error({ account: mapping.alias }, "Account sync failed");
        await this.alerts
          .send({
            account: mapping.alias,
            detail: "Account sync failed; check the account result in the app",
            severity: "error",
            type: "account-sync-failed",
          })
          .catch(() => this.logger.warn("Alert delivery failed"));
      }
      report.accounts.push(accountReport);
      for (const key of Object.keys(emptyCounts()) as Array<keyof SyncCounts>)
        report[key] += accountReport[key];
      completed += 1;
      options.progress?.({
        completed,
        stage: "Accounts Processed",
        total: mappings.length,
      });
    }

    // Publish successful and partial account writes even when another account failed.
    if (!options.dryRun) {
      options.progress?.({
        completed,
        stage: "Publish to Actual",
        total: mappings.length,
      });
      try {
        await this.actual.sync();
        report.publication = "published";
      } catch {
        report.publication = "failed";
      }
    }
    return report;
  }

  private async reconcileMapping(
    mapping: AccountMapping,
    since: string,
    transferPayees: Map<string, ActualPayee>,
    report: SyncCounts,
    dryRun = false,
    progress: (stage: string) => void = () => {},
  ): Promise<void> {
    progress("Read Up");
    const transactions = await this.withConnectionFallback(mapping, (client) =>
      client.listTransactions(mapping.upAccountId, since),
    );
    progress("Read Actual");
    // Settlement and Actual rules can move dates outside the Up creation window.
    const existing = await this.existingTransactions(mapping, HISTORY_START);
    const seen = new Set(transactions.map(({ id }) => importedId(id)));

    transactions.sort((left, right) => {
      const leftTransfer =
        left.relationships.transferAccount?.data && left.attributes.amount.valueInBaseUnits < 0;
      const rightTransfer =
        right.relationships.transferAccount?.data && right.attributes.amount.valueInBaseUnits < 0;
      return Number(Boolean(rightTransfer)) - Number(Boolean(leftTransfer));
    });

    progress(dryRun ? "Preview Changes" : "Apply Changes");
    const changes = transactions.map((up): Change => {
      const current = existing.get(importedId(up.id));
      const transferAccount = up.relationships.transferAccount?.data?.id;
      const target = transferAccount
        ? this.config.mappings.find(({ upAccountId }) => upAccountId === transferAccount)
        : undefined;
      const transferPayee = target ? transferPayees.get(target.actualAccountId) : undefined;
      const converted = convertTransaction(up, mapping, this.config, current, transferPayee);
      return { converted, current, transferPayee, up };
    });
    report.inspected += changes.length;
    if (dryRun) for (const change of changes) this.preview(mapping, change, report);
    else await this.importAll(mapping, changes, report);

    // A partial Up window cannot prove that an absent transaction was deleted.
    if (since > `${HISTORY_START}T00:00:00.000Z`) return;
    for (const transaction of existing.values()) {
      if (
        !transaction.imported_id?.startsWith(IMPORT_PREFIX) ||
        seen.has(transaction.imported_id)
      ) {
        continue;
      }
      await this.mirrorDeletion(mapping, transaction, report, dryRun);
    }
  }

  private preview(
    mapping: AccountMapping,
    { converted, current, transferPayee, up }: Change,
    report: SyncCounts,
  ): void {
    const category = up.relationships.category?.data?.id;
    const categoryChange =
      current &&
      !current.category &&
      category &&
      this.config.categoryMappings[category] &&
      !transferPayee;
    const changed =
      !current ||
      current.amount !== converted.amount ||
      current.date !== converted.date ||
      current.cleared !== converted.cleared ||
      current.imported_payee !== converted.imported_payee ||
      (converted.payee !== undefined && current.payee !== converted.payee) ||
      Boolean(categoryChange);
    const action = !current ? "would-import" : changed ? "would-update" : "unchanged";
    this.metrics.transactions.inc({ account: mapping.alias, action });
    if (!current) report.imported += 1;
    else if (changed) report.updated += 1;
    else report.unchanged += 1;
  }

  private async importAll(
    mapping: AccountMapping,
    changes: Change[],
    report: SyncCounts,
  ): Promise<void> {
    if (!changes.length) return;
    // One batch per account; Actual still matches and applies rules to each transaction.
    const result = await this.actual.importTransactions(
      mapping.actualAccountId,
      changes.map(({ converted }) => converted),
    );
    if (result.errors.length > 0) {
      throw new Error("Actual transaction import failed");
    }
    const updated = new Set(result.updated);
    // New Up IDs that Actual matched to an existing unimported transaction are updates.
    let added = result.added.length;
    const categoryUpdates: CategoryUpdate[] = [];
    for (const { converted, current, transferPayee, up } of changes) {
      const action = current
        ? updated.has(current.id)
          ? "updated"
          : "unchanged"
        : added-- > 0
          ? "imported"
          : "updated";
      this.metrics.transactions.inc({ account: mapping.alias, action });
      report[action] += 1;
      const upCategoryId = up.relationships.category?.data?.id;
      const categoryId = upCategoryId ? this.config.categoryMappings[upCategoryId] : undefined;
      if (categoryId && !transferPayee)
        categoryUpdates.push({
          categoryId,
          importedId: converted.imported_id,
          unchanged: action === "unchanged",
        });
    }
    await this.applyCategories(mapping, categoryUpdates, report);
  }

  private async applyCategories(
    mapping: AccountMapping,
    updates: CategoryUpdate[],
    report: SyncCounts,
  ): Promise<void> {
    if (!updates.length) return;
    // Read once after import rules have run, including any date or category edits.
    const refreshed = await this.existingTransactions(mapping, HISTORY_START);
    for (const update of updates) {
      const transaction = refreshed.get(update.importedId);
      if (!transaction || transaction.category) continue;
      await this.actual.updateTransaction(transaction.id, { category: update.categoryId });
      transaction.category = update.categoryId;
      if (update.unchanged) {
        report.unchanged -= 1;
        report.updated += 1;
      }
      this.metrics.transactions.inc({
        account: mapping.alias,
        action: "categorised",
      });
    }
  }

  private async mirrorDeletion(
    mapping: AccountMapping,
    transaction: ActualTransaction,
    report: SyncCounts,
    dryRun: boolean,
  ): Promise<void> {
    const safe = isSafeToDelete(transaction);
    if (!safe) {
      report.conflicts += 1;
      this.metrics.transactions.inc({
        account: mapping.alias,
        action: "delete-conflict",
      });
      await this.alerts
        .send({
          account: mapping.alias,
          detail: "Up deleted a transaction that has protected Actual edits",
          severity: "warning",
          type: "delete-conflict",
        })
        .catch(() => this.logger.warn("Alert delivery failed"));
      return;
    }
    if (!dryRun) await this.actual.deleteTransaction(transaction.id);
    report.deleted += 1;
    this.metrics.transactions.inc({
      account: mapping.alias,
      action: dryRun ? "would-delete" : "deleted",
    });
  }

  private async existingTransactions(
    mapping: AccountMapping,
    startDate: string,
  ): Promise<Map<string, ActualTransaction>> {
    const values = await this.actual.getTransactions(mapping.actualAccountId, startDate, END_DATE);
    return new Map(
      values
        .filter(({ imported_id }) => imported_id?.startsWith(IMPORT_PREFIX))
        .map((transaction) => [transaction.imported_id!, transaction]),
    );
  }

  private async transferPayees(): Promise<Map<string, ActualPayee>> {
    return new Map(
      (await this.actual.getPayees())
        .filter(({ transfer_acct }) => transfer_acct)
        .map((payee) => [payee.transfer_acct!, payee]),
    );
  }

  private async withConnectionFallback<T>(
    mapping: AccountMapping,
    operation: (client: UpClientLike) => Promise<T>,
  ): Promise<T> {
    let lastError: unknown;
    for (const id of mapping.connections) {
      try {
        return await operation(this.client(id));
      } catch (error) {
        lastError = error;
        this.logger.warn({ account: mapping.alias, connection: id }, "Up connection failed");
      }
    }
    throw lastError ?? new Error(`No Up connection is configured for ${mapping.alias}`);
  }

  private client(id: string): UpClientLike {
    const client = this.upClients.get(id);
    if (!client) throw new ConfigError(`Unknown Up connection ${id}`);
    return client;
  }
}

export function convertTransaction(
  transaction: UpTransaction,
  mapping: AccountMapping,
  config: AppConfig,
  existing?: ActualTransaction,
  transferPayee?: ActualPayee,
): ActualImportTransaction {
  const output: ActualImportTransaction = {
    account: mapping.actualAccountId,
    amount: transaction.attributes.amount.valueInBaseUnits,
    cleared: transaction.attributes.status === "SETTLED",
    date: actualDate(
      transaction.attributes.settledAt ?? transaction.attributes.createdAt,
      config.schedule.timezone,
    ),
    imported_id: importedId(transaction.id),
    imported_payee: transaction.attributes.rawText ?? transaction.attributes.description,
  };

  if (transferPayee) output.payee = transferPayee.id;
  else output.payee_name = transaction.attributes.description;
  if (!existing) {
    const notes = transactionNotes(transaction, config);
    if (notes) output.notes = notes;
  }
  return output;
}

export function actualDate(value: string, timezone: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: timezone,
    year: "numeric",
  }).formatToParts(new Date(value));
  const get = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function isSafeToDelete(transaction: ActualTransaction): boolean {
  if (transaction.is_parent || transaction.is_child || transaction.subtransactions?.length) {
    return false;
  }
  return !transaction.category && !transaction.notes && !transaction.reconciled;
}

function transactionNotes(transaction: UpTransaction, config: AppConfig): string | undefined {
  const values: string[] = [];
  const attributes = transaction.attributes;
  if (config.notes.includeMessage && attributes.message) values.push(attributes.message);
  if (config.notes.includePerformer && attributes.performingCustomer?.displayName) {
    values.push(`Performed by ${attributes.performingCustomer.displayName}`);
  }
  if (config.notes.includeForeignAmount && attributes.foreignAmount) {
    values.push(
      `Foreign amount ${attributes.foreignAmount.value} ${attributes.foreignAmount.currencyCode}`,
    );
  }
  if (config.notes.includeCashback && attributes.cashback) {
    values.push(
      `Cashback ${attributes.cashback.amount.value} ${attributes.cashback.amount.currencyCode}: ${attributes.cashback.description}`,
    );
  }
  if (config.notes.includeRoundUp && attributes.roundUp) {
    values.push(
      `Round-up ${attributes.roundUp.amount.value} ${attributes.roundUp.amount.currencyCode}`,
    );
  }
  return values.length > 0 ? values.join(" · ") : undefined;
}

function importedId(id: string): string {
  return `${IMPORT_PREFIX}${id}`;
}

function lookbackTimestamp(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

function normaliseSince(value: string): string {
  const candidate = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00.000Z` : value;
  const date = new Date(candidate);
  if (Number.isNaN(date.getTime())) throw new ConfigError(`Invalid since value ${value}`);
  return date.toISOString();
}

function emptyCounts(): SyncCounts {
  return {
    conflicts: 0,
    deleted: 0,
    failed: 0,
    imported: 0,
    inspected: 0,
    unchanged: 0,
    updated: 0,
  };
}

function emptyReport(): SyncReport {
  return {
    ...emptyCounts(),
    accounts: [],
    preview: false,
    publication: "not-required",
  };
}
