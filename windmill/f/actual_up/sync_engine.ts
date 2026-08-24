import type {
  AccountMapping,
  ActualClientLike,
  ActualImportTransaction,
  ActualPayee,
  ActualTransaction,
  ActualUpConfig,
  SyncOptions,
  SyncReport,
  UpClientLike,
  UpTransaction,
} from "./types";

const IMPORT_PREFIX = "up:";
const END_DATE = "2999-12-31";

export class SyncEngine {
  constructor(
    private readonly config: ActualUpConfig,
    private readonly actual: ActualClientLike,
    private readonly upClients: Map<string, UpClientLike>,
  ) {}

  async validate(): Promise<{ actualVersion: string }> {
    const [accounts, categories, actualVersion] = await Promise.all([
      this.actual.getAccounts(),
      this.actual.getCategories(),
      this.actual.getServerVersion(),
    ]);
    const accountIds = new Set(accounts.map(({ id }) => id));
    const categoryIds = new Set(categories.map(({ id }) => id));
    for (const mapping of this.config.mappings) {
      if (!accountIds.has(mapping.actualAccountId)) {
        throw new Error(
          `Mapping ${mapping.alias} references a missing Actual account`,
        );
      }
      let accessible = false;
      for (const connection of mapping.connections) {
        const values = await this.client(connection).listAccounts();
        accessible ||= values.some(({ id }) => id === mapping.upAccountId);
      }
      if (!accessible)
        throw new Error(
          `No configured token can access mapping ${mapping.alias}`,
        );
    }
    for (const categoryId of Object.values(this.config.categoryMappings)) {
      if (!categoryIds.has(categoryId))
        throw new Error(
          "A category mapping references a missing Actual category",
        );
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
        safeLog("account-sync-failed", { account: mapping.alias });
        await this.alert(mapping.alias, "error", "account-sync-failed");
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
      throw new Error("The Up webhook omitted its transaction identity");
    if (eventType === "TRANSACTION_DELETED")
      return this.deleteByImportedId(transactionId);
    const transaction =
      await this.client(connectionId).getTransaction(transactionId);
    const mapping = this.config.mappings.find(
      ({ upAccountId }) =>
        upAccountId === transaction.relationships.account.data.id,
    );
    if (!mapping) {
      safeLog("unmapped-webhook", { connection: connectionId });
      return emptyReport();
    }
    if (!mapping.connections.includes(connectionId)) {
      throw new Error("The Up connection is not permitted for this mapping");
    }
    const report = emptyReport();
    const existing = await this.existingTransactions(
      mapping,
      dateDaysBefore(transaction.attributes.createdAt, 7),
    );
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
    const existing = await this.existingTransactions(
      mapping,
      actualDate(since, this.config.schedule.timezone),
    );
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
      if (current) report.updated += 1;
      else report.imported += 1;
      return;
    }
    const result = await this.actual.importTransaction(
      mapping.actualAccountId,
      converted,
    );
    if (result.errors.length > 0)
      throw new Error("Actual rejected a transaction import");
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
    if (!isSafeToDelete(transaction)) {
      report.conflicts += 1;
      await this.alert(mapping.alias, "warning", "delete-conflict");
      return;
    }
    if (!dryRun) await this.actual.deleteTransaction(transaction.id);
    report.deleted += 1;
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
        safeLog("up-connection-failed", {
          account: mapping.alias,
          connection: id,
        });
      }
    }
    throw (
      lastError ?? new Error("No Up connection is configured for the mapping")
    );
  }

  private client(id: string): UpClientLike {
    const client = this.upClients.get(id);
    if (!client) throw new Error(`Unknown Up connection ${id}`);
    return client;
  }

  private async alert(
    account: string,
    severity: "error" | "warning",
    type: string,
  ): Promise<void> {
    if (!this.config.alerts) return;
    try {
      const response = await fetch(this.config.alerts.url, {
        body: JSON.stringify({ account, severity, source: "actual-up", type }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok)
        safeLog("alert-failed", { status: response.status, type });
    } catch {
      safeLog("alert-failed", { type });
    }
  }
}

export function convertTransaction(
  transaction: UpTransaction,
  mapping: AccountMapping,
  config: ActualUpConfig,
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
  config: ActualUpConfig,
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
  if (Number.isNaN(date.getTime())) throw new Error("Invalid since value");
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

function safeLog(event: string, fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ event, ...fields }));
}
