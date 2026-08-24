//native
import * as wmill from "windmill-client";

type Action = "discover" | "sync-dry-run" | "sync-live" | "validate";

export async function main(action: Action) {
  switch (action) {
    case "discover":
      return wmill.runScript("f/actual_up/discover", null, {});
    case "sync-dry-run":
      return wmill.runScript("f/actual_up/sync", null, {
        dryRun: true,
        trigger: "manual",
      });
    case "sync-live":
      return wmill.runScript("f/actual_up/sync", null, {
        dryRun: false,
        trigger: "manual",
      });
    case "validate":
      return wmill.runScript("f/actual_up/validate", null, {});
  }
}
