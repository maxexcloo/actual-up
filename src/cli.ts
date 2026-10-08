#!/usr/bin/env node

import { Command } from "commander";

import { loadConfig } from "./config.js";
import { JobRunner } from "./job-runner.js";
import { assertActualCompatibility, createRuntime } from "./runtime.js";
import { startService } from "./server.js";

const program = new Command()
  .name("actual-up")
  .description("Synchronise Up transactions into Actual Budget")
  .option(
    "-c, --config <path>",
    "configuration file",
    process.env.ACTUAL_UP_CONFIG ?? "/config/config.yaml",
  );

program
  .command("serve")
  .description("run the web app and reconciliation schedule")
  .action(async () => {
    const config = await loadConfig(program.opts<{ config: string }>().config);
    const runtime = await createRuntime(config);
    try {
      const validation = await runtime.engine.validate();
      assertActualCompatibility(validation.actualVersion);
      const runner = new JobRunner(runtime.metrics, runtime.logger);
      const service = await startService(
        config,
        runtime.engine,
        runner,
        runtime.metrics,
        runtime.logger,
        runtime,
      );
      await waitForSignal();
      await service.close();
    } finally {
      await runtime.actual.close();
    }
  });

program
  .command("validate")
  .description("validate configuration, credentials and mappings")
  .action(async () => {
    const config = await loadConfig(program.opts<{ config: string }>().config);
    const runtime = await createRuntime(config);
    try {
      const validation = await runtime.engine.validate();
      assertActualCompatibility(validation.actualVersion);
      process.stdout.write(
        `${JSON.stringify({ ok: true, ...validation }, null, 2)}\n`,
      );
    } finally {
      await runtime.actual.close();
    }
  });

program
  .command("discover")
  .description("list available Up and Actual accounts and categories")
  .action(async () => {
    const config = await loadConfig(program.opts<{ config: string }>().config);
    const runtime = await createRuntime(config);
    try {
      const up = Object.fromEntries(
        await Promise.all(
          [...runtime.clients].map(async ([id, client]) => [
            id,
            await client.listAccounts(),
          ]),
        ),
      );
      process.stdout.write(
        `${JSON.stringify(
          {
            actual: {
              accounts: await runtime.actual.getAccounts(),
              categories: await runtime.actual.getCategories(),
            },
            up,
          },
          null,
          2,
        )}\n`,
      );
    } finally {
      await runtime.actual.close();
    }
  });

program
  .command("sync")
  .description("run reconciliation or an explicit backfill")
  .option("--account <alias...>", "limit reconciliation to account aliases")
  .option("--dry-run", "report intended changes without writing", false)
  .option(
    "--since <date>",
    "fetch transactions since an RFC 3339 timestamp or YYYY-MM-DD",
  )
  .action(
    async (options: {
      account?: string[];
      dryRun: boolean;
      since?: string;
    }) => {
      const config = await loadConfig(
        program.opts<{ config: string }>().config,
      );
      const runtime = await createRuntime(config);
      try {
        const report = await runtime.engine.reconcile({
          dryRun: options.dryRun,
          mappingAliases: options.account,
          since: options.since,
        });
        process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
        if (report.failed > 0) process.exitCode = 1;
      } finally {
        await runtime.actual.close();
      }
    },
  );

const webhook = program.command("webhook").description("manage Up webhooks");

webhook
  .command("create <connection>")
  .description("create a webhook and print its one-time secret")
  .action(async (connectionId: string) => {
    const config = await loadConfig(program.opts<{ config: string }>().config);
    if (!config.server.publicUrl)
      throw new Error("server.publicUrl is required");
    const runtime = await createRuntime(config);
    try {
      const client = requiredClient(runtime.clients, connectionId);
      const target = `${config.server.publicUrl.replace(/\/$/, "")}/webhooks/up/${connectionId}`;
      const created = await client.createWebhook(
        target,
        `actual-up:${connectionId}`,
      );
      process.stdout.write(`${JSON.stringify(created, null, 2)}\n`);
    } finally {
      await runtime.actual.close();
    }
  });

webhook
  .command("delete <connection> [webhookId]")
  .description("delete the configured or supplied webhook")
  .action(async (connectionId: string, webhookId?: string) => {
    const config = await loadConfig(program.opts<{ config: string }>().config);
    const connection = config.up.connections.find(
      ({ id }) => id === connectionId,
    );
    const id = webhookId ?? connection?.webhook?.id;
    if (!id) throw new Error("No webhook ID was supplied or configured");
    const runtime = await createRuntime(config);
    try {
      await requiredClient(runtime.clients, connectionId).deleteWebhook(id);
    } finally {
      await runtime.actual.close();
    }
  });

webhook
  .command("ping <connection> [webhookId]")
  .description("send a test event to the configured or supplied webhook")
  .action(async (connectionId: string, webhookId?: string) => {
    const config = await loadConfig(program.opts<{ config: string }>().config);
    const connection = config.up.connections.find(
      ({ id }) => id === connectionId,
    );
    const id = webhookId ?? connection?.webhook?.id;
    if (!id) throw new Error("No webhook ID was supplied or configured");
    const runtime = await createRuntime(config);
    try {
      await requiredClient(runtime.clients, connectionId).pingWebhook(id);
    } finally {
      await runtime.actual.close();
    }
  });

webhook
  .command("status <connection>")
  .description("list the connection's Up webhooks")
  .action(async (connectionId: string) => {
    const config = await loadConfig(program.opts<{ config: string }>().config);
    const runtime = await createRuntime(config);
    try {
      const values = await requiredClient(
        runtime.clients,
        connectionId,
      ).listWebhooks();
      process.stdout.write(`${JSON.stringify(values, null, 2)}\n`);
    } finally {
      await runtime.actual.close();
    }
  });

program.parseAsync().catch((error: unknown) => {
  process.stderr.write(
    `actual-up: ${error instanceof Error ? error.name : "Error"}; check configuration and connectivity\n`,
  );
  process.exitCode = 1;
});

function requiredClient<T>(clients: Map<string, T>, id: string): T {
  const client = clients.get(id);
  if (!client) throw new Error(`Unknown Up connection ${id}`);
  return client;
}

async function waitForSignal(): Promise<void> {
  await new Promise<void>((resolvePromise) => {
    process.once("SIGINT", resolvePromise);
    process.once("SIGTERM", resolvePromise);
  });
}
