import pino from "pino";
import { describe, expect, it, vi } from "vitest";

import { UpClient } from "../src/up-client.js";

function page(id: string, next: string | null) {
  return new Response(
    JSON.stringify({
      data: [
        {
          id,
          type: "accounts",
          attributes: {
            accountType: "TRANSACTIONAL",
            displayName: id,
            ownershipType: "INDIVIDUAL",
            balance: {
              currencyCode: "AUD",
              value: "0.00",
              valueInBaseUnits: 0,
            },
          },
        },
      ],
      links: { next, prev: null },
    }),
    { headers: { "Content-Type": "application/json" } },
  );
}

describe("Up client", () => {
  it("does not expose upstream response bodies in errors", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response("private transaction details", { status: 400 }),
      );
    const client = new UpClient("token", pino({ level: "silent" }), fetcher);
    await expect(client.ping()).rejects.toMatchObject({
      message: "Up API returned 400",
      status: 400,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("follows opaque pagination links on the trusted origin", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        page("one", "https://api.up.com.au/api/v1/accounts?page[after]=x"),
      )
      .mockResolvedValueOnce(page("two", null));
    const client = new UpClient("token", pino({ level: "silent" }), fetcher);
    expect((await client.listAccounts()).map(({ id }) => id)).toEqual([
      "one",
      "two",
    ]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0]?.[1]?.headers).toMatchObject({
      Authorization: "Bearer token",
    });
  });

  it("rejects pagination links outside the Up API origin", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(page("one", "https://attacker.example/next"));
    const client = new UpClient("token", pino({ level: "silent" }), fetcher);
    await expect(client.listAccounts()).rejects.toThrow("untrusted origin");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
