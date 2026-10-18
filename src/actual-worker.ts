import { parentPort, workerData } from "node:worker_threads";
import { ActualApiClient } from "./actual-api-client.js";
import type { AppConfig } from "./config.js";
import { ConfigError } from "./errors.js";
import type { ActualClient } from "./types.js";

const client = new ActualApiClient(workerData as AppConfig);
// Keep the SDK singleton serial even if a caller accidentally overlaps requests.
let chain = Promise.resolve();
parentPort!.on(
  "message",
  ({ id, method, args }: { id: number; method: keyof ActualClient; args: unknown[] }) => {
    chain = chain.then(async () => {
      try {
        const operation = client[method] as (...args: unknown[]) => Promise<unknown>;
        const value = await operation.apply(client, args);
        parentPort!.postMessage({ id, ok: true, value });
      } catch (error) {
        // SDK errors can contain bank data; only the app's own messages cross the boundary.
        parentPort!.postMessage({
          id,
          ok: false,
          reason: error instanceof ConfigError ? error.message : undefined,
        });
      }
    });
  },
);
