import type { Logger } from "pino";
import { z } from "zod";

import type {
  UpAccount,
  UpClientLike,
  UpTransaction,
  UpWebhook,
} from "./types.js";

const API_BASE_URL = "https://api.up.com.au/api/v1";

const resourceSchema = z.object({
  attributes: z.record(z.string(), z.unknown()),
  id: z.string(),
  relationships: z.record(z.string(), z.unknown()).optional(),
  type: z.string(),
});

const collectionSchema = z.object({
  data: z.array(resourceSchema),
  links: z.object({ next: z.string().nullable(), prev: z.string().nullable() }),
});

const singleSchema = z.object({ data: resourceSchema });

export class UpApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export class UpClient implements UpClientLike {
  constructor(
    private readonly token: string,
    private readonly logger: Logger,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async ping(): Promise<void> {
    await this.request("/util/ping");
  }

  async listAccounts(): Promise<UpAccount[]> {
    return (await this.paginate("/accounts?page%5Bsize%5D=100")) as UpAccount[];
  }

  async listTransactions(
    accountId: string,
    since: string,
  ): Promise<UpTransaction[]> {
    const query = new URLSearchParams({
      "filter[since]": since,
      "page[size]": "100",
    });
    return (await this.paginate(
      `/accounts/${encodeURIComponent(accountId)}/transactions?${query.toString()}`,
    )) as UpTransaction[];
  }

  async getTransaction(id: string): Promise<UpTransaction> {
    const value = singleSchema.parse(
      await this.request(`/transactions/${encodeURIComponent(id)}`),
    );
    return value.data as unknown as UpTransaction;
  }

  async listWebhooks(): Promise<UpWebhook[]> {
    return (await this.paginate("/webhooks?page%5Bsize%5D=100")) as UpWebhook[];
  }

  async createWebhook(url: string, description: string): Promise<UpWebhook> {
    const value = singleSchema.parse(
      await this.request("/webhooks", {
        body: JSON.stringify({
          data: { attributes: { description, url }, type: "webhooks" },
        }),
        method: "POST",
      }),
    );
    return value.data as unknown as UpWebhook;
  }

  async deleteWebhook(id: string): Promise<void> {
    await this.request(`/webhooks/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  }

  async pingWebhook(id: string): Promise<void> {
    await this.request(`/webhooks/${encodeURIComponent(id)}/ping`, {
      method: "POST",
    });
  }

  private async paginate(
    path: string,
  ): Promise<Array<Record<string, unknown>>> {
    const output: Array<Record<string, unknown>> = [];
    let next: string | null = this.url(path).toString();
    while (next) {
      const url = new URL(next);
      if (url.origin !== "https://api.up.com.au") {
        throw new Error("Up pagination returned an untrusted origin");
      }
      const page = collectionSchema.parse(await this.request(url.toString()));
      output.push(...page.data);
      next = page.links.next;
    }
    return output;
  }

  private async request(
    path: string,
    init: RequestInit = {},
  ): Promise<unknown> {
    const url = this.url(path);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      let response: Response;
      try {
        response = await this.fetcher(url, {
          ...init,
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${this.token}`,
            "Content-Type": "application/json",
            ...init.headers,
          },
          signal: AbortSignal.timeout(20_000),
        });
      } catch (error) {
        if (attempt === 4) throw error;
        await this.backoff(attempt);
        continue;
      }

      if (response.status === 204) return undefined;
      if (response.ok) return response.json();

      await response.body?.cancel();
      if ((response.status === 429 || response.status >= 500) && attempt < 4) {
        this.logger.warn(
          { attempt: attempt + 1, status: response.status },
          "Retrying Up API",
        );
        await this.backoff(attempt, response.headers.get("retry-after"));
        continue;
      }
      throw new UpApiError(
        `Up API returned ${response.status}`,
        response.status,
      );
    }
    throw new Error("Up API retry loop ended unexpectedly");
  }

  private url(path: string): URL {
    if (path.startsWith("http")) return new URL(path);
    return new URL(`${API_BASE_URL}${path}`);
  }

  private async backoff(
    attempt: number,
    retryAfter: string | null = null,
  ): Promise<void> {
    const retrySeconds = retryAfter
      ? Number.parseInt(retryAfter, 10)
      : Number.NaN;
    const delay = Number.isFinite(retrySeconds)
      ? retrySeconds * 1000
      : Math.min(10_000, 250 * 2 ** attempt) + Math.floor(Math.random() * 200);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, delay));
  }
}
