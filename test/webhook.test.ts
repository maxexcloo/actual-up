import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { parseWebhook, verifyWebhookSignature } from "../src/webhook.js";

describe("Up webhooks", () => {
  const body = Buffer.from(
    JSON.stringify({
      data: {
        id: "event-id",
        type: "webhook-events",
        attributes: {
          createdAt: "2026-08-19T10:00:00+10:00",
          eventType: "TRANSACTION_CREATED",
        },
        relationships: {
          transaction: { data: { id: "transaction-id", type: "transactions" } },
          webhook: { data: { id: "webhook-id", type: "webhooks" } },
        },
      },
    }),
  );

  it("verifies the exact raw body", () => {
    const signature = createHmac("sha256", "secret").update(body).digest("hex");
    expect(verifyWebhookSignature(body, signature, "secret")).toBe(true);
    expect(
      verifyWebhookSignature(
        Buffer.concat([body, Buffer.from(" ")]),
        signature,
        "secret",
      ),
    ).toBe(false);
  });

  it("rejects malformed signatures", () => {
    expect(verifyWebhookSignature(body, undefined, "secret")).toBe(false);
    expect(verifyWebhookSignature(body, "not-hex", "secret")).toBe(false);
  });

  it("parses supported event payloads", () => {
    expect(parseWebhook(body).data.attributes.eventType).toBe(
      "TRANSACTION_CREATED",
    );
  });
});
