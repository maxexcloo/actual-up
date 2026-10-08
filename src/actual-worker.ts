import { parentPort, workerData } from "node:worker_threads";
import { ActualApiClient } from "./actual-api-client.js";
import {
  setActualCredentials,
  type ActualCredentials,
} from "./settings-store.js";
import type { AppConfig } from "./config.js";
import type { ActualClient } from "./types.js";

const { config, credentials } = workerData as {
  config: AppConfig;
  credentials: ActualCredentials;
};
setActualCredentials(config, credentials);
const client = new ActualApiClient(config);
// Keep the SDK singleton serial even if a caller accidentally overlaps requests.
let chain = Promise.resolve();
parentPort!.on(
  "message",
  ({
    id,
    method,
    args,
  }: {
    id: number;
    method: keyof ActualClient;
    args: unknown[];
  }) => {
    chain = chain.then(async () => {
      try {
        const operation = client[method] as (
          ...args: unknown[]
        ) => Promise<unknown>;
        const value = await operation.apply(client, args);
        parentPort!.postMessage({ id, ok: true, value });
      } catch {
        parentPort!.postMessage({ id, ok: false });
      }
    });
  },
);
