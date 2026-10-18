import { createRequire } from "node:module";

import { ConfigError } from "./errors.js";

const require = createRequire(import.meta.url);
const packageManifest = require("../package.json") as {
  dependencies: Record<string, string>;
};

export function assertActualCompatibility(serverVersion: string): void {
  const apiVersion = packageManifest.dependencies["@actual-app/api"];
  if (!apiVersion) throw new ConfigError("@actual-app/api is missing from dependencies");
  const expected = apiVersion.split(".").slice(0, 2).join(".");
  const actual = serverVersion.split(".").slice(0, 2).join(".");
  if (expected !== actual) {
    throw new ConfigError(
      `Actual server ${serverVersion} is incompatible with API ${apiVersion}; align the versions`,
    );
  }
}
