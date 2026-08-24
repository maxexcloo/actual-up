//native
import { createRuntime, recordRun } from "./runtime";

export async function main(
  dryRun = true,
  since?: string,
  accounts?: string[],
  trigger: "manual" | "schedule" = "manual",
) {
  const { engine } = await createRuntime();
  const report = await engine.reconcile({
    dryRun,
    mappingAliases: accounts,
    since,
  });
  await recordRun(trigger, report);
  if (report.failed > 0) {
    throw new Error(`${report.failed} account synchronisation(s) failed`);
  }
  return report;
}
