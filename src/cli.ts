#!/usr/bin/env node

import { Command } from "commander";

import { loadConfig } from "./config.js";
import { discoverActualAccounts, discoverUpAccounts } from "./discovery.js";
import { ConfigError } from "./errors.js";
import { JobRunner } from "./job-runner.js";
import { createRuntime } from "./runtime.js";
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
      process.stdout.write(`${JSON.stringify({ ok: true, ...validation }, null, 2)}\n`);
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
          [...runtime.clients].map(async ([id, client]) => [id, await discoverUpAccounts(client)]),
        ),
      );
      process.stdout.write(
        `${JSON.stringify(
          {
            actual: {
              accounts: await discoverActualAccounts(runtime.actual),
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
  .option("--since <date>", "fetch transactions since an RFC 3339 timestamp or YYYY-MM-DD")
  .action(async (options: { account?: string[]; dryRun: boolean; since?: string }) => {
    const config = await loadConfig(program.opts<{ config: string }>().config);
    const runtime = await createRuntime(config);
    try {
      // Match the service: read the latest budget before reconciling against it.
      await runtime.actual.sync();
      const report = await runtime.engine.reconcile({
        dryRun: options.dryRun,
        mappingAliases: options.account,
        since: options.since,
      });
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      if (report.failed > 0 || report.publication === "failed") process.exitCode = 1;
    } finally {
      await runtime.actual.close();
    }
  });

program.parseAsync().catch((error: unknown) => {
  // Upstream SDK errors can contain bank data; only the app's own messages are printed.
  process.stderr.write(
    `actual-up: ${error instanceof ConfigError ? error.message : `${error instanceof Error ? error.name : "Error"}; check configuration and connectivity`}\n`,
  );
  process.exitCode = 1;
});

async function waitForSignal(): Promise<void> {
  await new Promise<void>((resolvePromise) => {
    process.once("SIGINT", resolvePromise);
    process.once("SIGTERM", resolvePromise);
  });
}
