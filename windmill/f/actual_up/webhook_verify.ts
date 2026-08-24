import { z } from "zod@4.4.3";

import type { UpWebhookEvent } from "./types";

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

export async function verifyWebhookSignature(
  body: string,
  signature: string | undefined,
  secret: string,
): Promise<boolean> {
  if (!signature || !/^[a-f\d]{64}$/i.test(signature)) return false;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
  const expected = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, encoder.encode(body)),
  );
  const received = Uint8Array.from(
    signature.match(/.{2}/g)!.map((value) => Number.parseInt(value, 16)),
  );
  let difference = expected.length ^ received.length;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= expected[index] ^ (received[index] ?? 0);
  }
  return difference === 0;
}

export function parseWebhook(body: string): UpWebhookEvent {
  return webhookEventSchema.parse(JSON.parse(body)) as UpWebhookEvent;
}
