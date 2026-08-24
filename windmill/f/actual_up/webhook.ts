//native

import { loadConfig } from "./config";
import { createRuntime, recordRun } from "./runtime";
import type { SyncReport } from "./types";
import { parseWebhook, verifyWebhookSignature } from "./webhook_verify";

type HttpEvent = {
  kind: "http";
  body: unknown;
  raw_string: string | null;
  headers: Record<string, string>;
};

type WebhookEventType =
  | "PING"
  | "TRANSACTION_CREATED"
  | "TRANSACTION_DELETED"
  | "TRANSACTION_SETTLED";

export async function preprocessor(event: HttpEvent) {
  if (event.kind !== "http" || !event.raw_string)
    throw new Error("Missing raw webhook body");
  const signature = Object.entries(event.headers).find(
    ([name]) => name.toLowerCase() === "x-up-authenticity-signature",
  )?.[1];
  const parsed = parseWebhook(event.raw_string);
  const webhookId = parsed.data.relationships.webhook.data.id;
  const config = await loadConfig();
  const connection = config.up.connections.find(
    (item) => item.webhook?.id === webhookId,
  );
  if (!connection?.webhook) throw new Error("Unknown Up webhook identity");
  if (
    !(await verifyWebhookSignature(
      event.raw_string,
      signature,
      connection.webhook.secret,
    ))
  ) {
    throw new Error("Invalid Up webhook signature");
  }
  return {
    connectionId: connection.id,
    eventType: parsed.data.attributes.eventType,
    transactionId: parsed.data.relationships.transaction?.data?.id,
  };
}

export async function main(
  connectionId: string,
  eventType: WebhookEventType,
  transactionId?: string,
) {
  const { engine } = await createRuntime();
  const report: SyncReport = await engine.reconcileWebhook(
    connectionId,
    eventType,
    transactionId,
  );
  await recordRun("webhook", report);
  return report;
}
