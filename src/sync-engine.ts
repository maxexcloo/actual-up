import type { Logger } from "pino";

import type { AlertSink } from "./alerts.js";
import type { AccountMapping, AppConfig } from "./config.js";
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

export type SyncReport = {
  conflicts: number;
  deleted: number;
  failed: number;
  imported: number;
  inspected: number;
  updated: number;
};

type SyncOptions = {
  dryRun?: boolean;
  mappingAliases?: string[];
  since?: string;
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
        throw new Error(
          `Mapping ${mapping.alias} references missing Actual account ${mapping.actualAccountId}`,
        );
      }
      await this.withConnectionFallback(mapping, async (client) => {
        const accessible = (await client.listAccounts()).some(
          ({ id }) => id === mapping.upAccountId,
        );
        if (!accessible)
          throw new Error("Connection cannot access the mapped Up account");
      });
    }

    for (const actualCategoryId of Object.values(
      this.config.categoryMappings,
    )) {
      if (!categoryIds.has(actualCategoryId)) {
        throw new Error(
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
      ({ alias }) =>
        !options.mappingAliases || options.mappingAliases.includes(alias),
    );
    const transferPayees = await this.transferPayees();

    for (const mapping of mappings) {
      try {
        await this.reconcileMapping(
          mapping,
          since,
          transferPayees,
          report,
          options.dryRun,
        );
      } catch {
        report.failed += 1;
        this.logger.error({ account: mapping.alias }, "Account sync failed");
        await this.alerts.send({
          account: mapping.alias,
          detail: "Account sync failed; see service logs",
          severity: "error",
          type: "account-sync-failed",
        });
      }
    }

    if (!options.dryRun && report.failed === 0) await this.actual.sync();
    return report;
  }

  async reconcileWebhook(
    connectionId: string,
    eventType: string,
    transactionId?: string,
  ): Promise<SyncReport> {
    if (eventType === "PING") return emptyReport();
    if (!transactionId)
      throw new Error(`${eventType} webhook omitted its transaction`);
    if (eventType === "TRANSACTION_DELETED") {
      return this.deleteByImportedId(transactionId);
    }

    const transaction =
      await this.client(connectionId).getTransaction(transactionId);
    const mapping = this.config.mappings.find(
      ({ upAccountId }) =>
        upAccountId === transaction.relationships.account.data.id,
    );
    if (!mapping) {
      this.logger.info(
        { connection: connectionId },
        "Ignoring webhook for an unmapped account",
      );
      return emptyReport();
    }
    if (!mapping.connections.includes(connectionId)) {
      throw new Error(
        `Connection ${connectionId} is not permitted for mapping ${mapping.alias}`,
      );
    }

    const report = emptyReport();
    const start = dateDaysBefore(transaction.attributes.createdAt, 7);
    const existing = await this.existingTransactions(mapping, start);
    await this.importOne(
      mapping,
      transaction,
      existing,
      await this.transferPayees(),
      report,
      false,
    );
    await this.actual.sync();
    return report;
  }

  private async reconcileMapping(
    mapping: AccountMapping,
    since: string,
    transferPayees: Map<string, ActualPayee>,
    report: SyncReport,
    dryRun = false,
  ): Promise<void> {
    const transactions = await this.withConnectionFallback(mapping, (client) =>
      client.listTransactions(mapping.upAccountId, since),
    );
    const startDate = actualDate(since, this.config.schedule.timezone);
    const existing = await this.existingTransactions(mapping, startDate);
    const seen = new Set(transactions.map(({ id }) => importedId(id)));

    transactions.sort((left, right) => {
      const leftTransfer =
        left.relationships.transferAccount?.data &&
        left.attributes.amount.valueInBaseUnits < 0;
      const rightTransfer =
        right.relationships.transferAccount?.data &&
        right.attributes.amount.valueInBaseUnits < 0;
      return Number(Boolean(rightTransfer)) - Number(Boolean(leftTransfer));
    });

    for (const transaction of transactions) {
      await this.importOne(
        mapping,
        transaction,
        existing,
        transferPayees,
        report,
        dryRun,
      );
    }

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

  private async importOne(
    mapping: AccountMapping,
    up: UpTransaction,
    existing: Map<string, ActualTransaction>,
    transferPayees: Map<string, ActualPayee>,
    report: SyncReport,
    dryRun: boolean,
  ): Promise<void> {
    report.inspected += 1;
    const id = importedId(up.id);
    const current = existing.get(id);
    const transferAccount = up.relationships.transferAccount?.data?.id;
    const target = transferAccount
      ? this.config.mappings.find(
          ({ upAccountId }) => upAccountId === transferAccount,
        )
      : undefined;
    const transferPayee = target
      ? transferPayees.get(target.actualAccountId)
      : undefined;
    const converted = convertTransaction(
      up,
      mapping,
      this.config,
      current,
      transferPayee,
    );

    if (dryRun) {
      const action = current ? "would-update" : "would-import";
      this.metrics.transactions.inc({ account: mapping.alias, action });
      if (current) report.updated += 1;
      else report.imported += 1;
      return;
    }

    const result = await this.actual.importTransaction(
      mapping.actualAccountId,
      converted,
    );
    if (result.errors.length > 0) {
      throw new Error("Actual transaction import failed");
    }
    const action = result.added.length > 0 ? "imported" : "updated";
    this.metrics.transactions.inc({ account: mapping.alias, action });
    if (result.added.length > 0) report.imported += 1;
    else report.updated += 1;

    const refreshed = await this.findImported(mapping, id, converted.date);
    if (refreshed) existing.set(id, refreshed);
    const upCategoryId = up.relationships.category?.data?.id;
    const actualCategoryId = upCategoryId
      ? this.config.categoryMappings[upCategoryId]
      : undefined;
    if (
      refreshed &&
      !refreshed.category &&
      actualCategoryId &&
      !transferPayee
    ) {
      await this.actual.updateTransaction(refreshed.id, {
        category: actualCategoryId,
      });
      refreshed.category = actualCategoryId;
      this.metrics.transactions.inc({
        account: mapping.alias,
        action: "categorised",
      });
    }
  }

  private async deleteByImportedId(
    upTransactionId: string,
  ): Promise<SyncReport> {
    const report = emptyReport();
    for (const mapping of this.config.mappings) {
      const transaction = await this.findImported(
        mapping,
        importedId(upTransactionId),
        "1900-01-01",
      );
      if (transaction) {
        await this.mirrorDeletion(mapping, transaction, report, false);
        await this.actual.sync();
        return report;
      }
    }
    return report;
  }

  private async mirrorDeletion(
    mapping: AccountMapping,
    transaction: ActualTransaction,
    report: SyncReport,
    dryRun: boolean,
  ): Promise<void> {
    const safe = isSafeToDelete(transaction);
    if (!safe) {
      report.conflicts += 1;
      this.metrics.transactions.inc({
        account: mapping.alias,
        action: "delete-conflict",
      });
      await this.alerts.send({
        account: mapping.alias,
        detail: "Up deleted a transaction that has protected Actual edits",
        severity: "warning",
        type: "delete-conflict",
      });
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
    const values = await this.actual.getTransactions(
      mapping.actualAccountId,
      startDate,
      END_DATE,
    );
    return new Map(
      values
        .filter(({ imported_id }) => imported_id?.startsWith(IMPORT_PREFIX))
        .map((transaction) => [transaction.imported_id!, transaction]),
    );
  }

  private async findImported(
    mapping: AccountMapping,
    id: string,
    startDate: string,
  ): Promise<ActualTransaction | undefined> {
    const values = await this.actual.getTransactions(
      mapping.actualAccountId,
      startDate,
      END_DATE,
    );
    return values.find(({ imported_id }) => imported_id === id);
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
        this.logger.warn(
          { account: mapping.alias, connection: id },
          "Up connection failed",
        );
      }
    }
    throw (
      lastError ??
      new Error(`No Up connection is configured for ${mapping.alias}`)
    );
  }

  private client(id: string): UpClientLike {
    const client = this.upClients.get(id);
    if (!client) throw new Error(`Unknown Up connection ${id}`);
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
    imported_payee:
      transaction.attributes.rawText ?? transaction.attributes.description,
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
  if (
    transaction.is_parent ||
    transaction.is_child ||
    transaction.subtransactions?.length
  ) {
    return false;
  }
  if (transaction.cleared === false) return !transaction.reconciled;
  return !transaction.category && !transaction.notes && !transaction.reconciled;
}

function transactionNotes(
  transaction: UpTransaction,
  config: AppConfig,
): string | undefined {
  const values: string[] = [];
  const attributes = transaction.attributes;
  if (config.notes.includeMessage && attributes.message)
    values.push(attributes.message);
  if (
    config.notes.includePerformer &&
    attributes.performingCustomer?.displayName
  ) {
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
  const candidate = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? `${value}T00:00:00.000Z`
    : value;
  const date = new Date(candidate);
  if (Number.isNaN(date.getTime()))
    throw new Error(`Invalid since value ${value}`);
  return date.toISOString();
}

function dateDaysBefore(value: string, days: number): string {
  return new Date(new Date(value).getTime() - days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

function emptyReport(): SyncReport {
  return {
    conflicts: 0,
    deleted: 0,
    failed: 0,
    imported: 0,
    inspected: 0,
    updated: 0,
  };
}
