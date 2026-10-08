import { parentPort, workerData } from "node:worker_threads";
parentPort.on("message", ({ id, method }) => {
  if (method === "sync")
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
  if (method === "deleteTransaction") process.exit(1);
  if (method === "getPayees")
    return parentPort.postMessage({
      id,
      ok: false,
      value: "private-upstream-error",
    });
  const value =
    method === "getServerVersion" ? workerData.credentials.method : undefined;
  parentPort.postMessage({ id, ok: true, value });
});
