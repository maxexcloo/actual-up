import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import type { UpWebhookEvent } from "./types.js";

const webhookEventSchema = z.object({
  data: z.object({
    attributes: z.object({
      createdAt: z.string(),
      eventType: z.enum([
        "PING",
        "TRANSACTION_CREATED",
        "TRANSACTION_DELETED",
        "TRANSACTION_SETTLED",
      ]),
    }),
    id: z.string(),
    relationships: z.object({
      transaction: z
        .object({
          data: z
            .object({ id: z.string(), type: z.literal("transactions") })
            .nullable(),
        })
        .optional(),
      webhook: z.object({
        data: z.object({ id: z.string(), type: z.literal("webhooks") }),
      }),
    }),
    type: z.literal("webhook-events"),
  }),
});

export function verifyWebhookSignature(
  body: Buffer,
  signature: string | undefined,
  secret: string,
): boolean {
  if (!signature || !/^[a-f\d]{64}$/i.test(signature)) return false;
  const expected = createHmac("sha256", secret).update(body).digest();
  const received = Buffer.from(signature, "hex");
  return (
    expected.length === received.length && timingSafeEqual(expected, received)
  );
}

export function parseWebhook(body: Buffer): UpWebhookEvent {
  return webhookEventSchema.parse(
    JSON.parse(body.toString("utf8")),
  ) as UpWebhookEvent;
}
