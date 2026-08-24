//native
import * as wmill from "windmill-client@1.792.0";

export async function main() {
  return (
    (await wmill.getState("f/actual_up/status")) ?? {
      finishedAt: null,
      jobId: null,
      report: null,
      trigger: null,
    }
  );
}
