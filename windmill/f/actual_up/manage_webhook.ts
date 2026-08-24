//native
import { createRuntime } from "./runtime";

type Operation = "create" | "delete" | "list" | "ping";

export async function main(
  connectionId: string,
  operation: Operation = "list",
  webhookId?: string,
  publicUrl = "https://windmill.mbk.excloo.dev/api/r/actual-up/up",
) {
  const { clients, config } = await createRuntime();
  const client = clients.get(connectionId);
  const connection = config.up.connections.find(
    ({ id }) => id === connectionId,
  );
  if (!client || !connection) throw new Error("Unknown Up connection");
  const id = webhookId ?? connection.webhook?.id;
  switch (operation) {
    case "list":
      return client.listWebhooks();
    case "create":
      return client.createWebhook(publicUrl, `actual-up:${connectionId}`);
    case "delete":
      if (!id) throw new Error("No webhook ID is configured");
      await client.deleteWebhook(id);
      return { ok: true };
    case "ping":
      if (!id) throw new Error("No webhook ID is configured");
      await client.pingWebhook(id);
      return { ok: true };
  }
}
