import { describe, expect, it } from "vitest";

import { parseConfig } from "../src/config.js";

const base = {
  version: 1 as const,
  actual: {
    passwordEnv: "ACTUAL_PASSWORD",
    serverUrl: "https://actual.example.com",
    syncId: "budget-id",
  },
  mappings: [
    {
      actualAccountId: "actual-spending",
      alias: "spending",
      connections: ["max"],
      upAccountId: "11111111-1111-4111-8111-111111111111",
    },
  ],
  up: { connections: [{ id: "max", tokenEnv: "UP_TOKEN_MAX" }] },
};

describe("configuration", () => {
  it("applies safe defaults", () => {
    const config = parseConfig(base);
    expect(config.schedule).toEqual({
      enabled: false,
      cron: "*/15 * * * *",
      lookbackDays: 30,
      timezone: "Australia/Sydney",
    });
    expect(config.server.port).toBe(3000);
    expect(config.notes.includePerformer).toBe(true);
  });

  it("accepts a budget ID from the environment and rejects ambiguous IDs", () => {
    const { syncId: _syncId, ...actual } = base.actual;
    expect(
      parseConfig({
        ...base,
        actual: { ...actual, syncIdEnv: "ACTUAL_SYNC_ID" },
      }).actual.syncIdEnv,
    ).toBe("ACTUAL_SYNC_ID");
    expect(() =>
      parseConfig({
        ...base,
        actual: { ...base.actual, syncIdEnv: "ACTUAL_SYNC_ID" },
      }),
    ).toThrow();
  });

  it("rejects duplicate bank-account mappings", () => {
    expect(() =>
      parseConfig({
        ...base,
        mappings: [...base.mappings, { ...base.mappings[0] }],
      }),
    ).toThrow("mapped more than once");
  });

  it("requires exactly one Actual authentication method", () => {
    expect(() =>
      parseConfig({
        ...base,
        actual: {
          ...base.actual,
          sessionTokenEnv: "ACTUAL_SESSION_TOKEN",
        },
      }),
    ).toThrow();
  });
});
