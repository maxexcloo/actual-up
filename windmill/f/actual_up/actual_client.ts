import type {
  ActualAccount,
  ActualCategory,
  ActualClientLike,
  ActualImportResult,
  ActualImportTransaction,
  ActualPayee,
  ActualTransaction,
} from "./types";

export class ActualBridgeClient implements ActualClientLike {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async open(): Promise<void> {}
  async close(): Promise<void> {}

  getServerVersion(): Promise<string> {
    return this.request("GET", "/version");
  }

  getAccounts(): Promise<ActualAccount[]> {
    return this.request("GET", "/accounts");
  }

  getCategories(): Promise<ActualCategory[]> {
    return this.request("GET", "/categories");
  }

  getPayees(): Promise<ActualPayee[]> {
    return this.request("GET", "/payees");
  }

  getTransactions(
    accountId: string,
    startDate: string,
    endDate: string,
  ): Promise<ActualTransaction[]> {
    return this.request("POST", "/transactions/query", {
      accountId,
      endDate,
      startDate,
    });
  }

  importTransaction(
    accountId: string,
    transaction: ActualImportTransaction,
  ): Promise<ActualImportResult> {
    return this.request("POST", "/transactions/import", {
      accountId,
      transaction,
    });
  }

  async updateTransaction(
    id: string,
    fields: Partial<ActualTransaction>,
  ): Promise<void> {
    await this.request(
      "PATCH",
      `/transactions/${encodeURIComponent(id)}`,
      fields,
    );
  }

  async deleteTransaction(id: string): Promise<void> {
    await this.request("DELETE", `/transactions/${encodeURIComponent(id)}`);
  }

  async sync(): Promise<void> {
    await this.request("POST", "/sync");
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const base = this.baseUrl.endsWith("/") ? this.baseUrl : `${this.baseUrl}/`;
    const url = new URL(`v1${path}`, base);
    const response = await this.fetcher(url, {
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      method,
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) {
      throw new Error(`Actual bridge returned ${response.status}`);
    }
    return (await response.json()) as T;
  }
}
