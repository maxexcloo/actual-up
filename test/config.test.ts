import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
      upAccountId: "11111111-1111-4111-8111-111111111111",
      connections: ["max"],
    },
  ],
  up: { connections: [{ id: "max", tokenEnv: "UP_TOKEN_MAX" }] },
};

beforeEach(() => vi.stubEnv("ACTUAL_UP_PUBLIC_URL", undefined));
afterEach(() => vi.unstubAllEnvs());

describe("configuration", () => {
  it("preserves the configured public URL when no environment override is set", () => {
    expect(parseConfig(base).server.publicUrl).toBeUndefined();
    expect(
      parseConfig({
        ...base,
        server: { publicUrl: "http://app.example.com:3000" },
      }).server.publicUrl,
    ).toBe("http://app.example.com:3000");
  });

  it("uses the environment public URL instead of the configured URL", () => {
    vi.stubEnv("ACTUAL_UP_PUBLIC_URL", "https://private.example.com");
    expect(
      parseConfig({ ...base, server: { publicUrl: "http://localhost:3000" } })
        .server.publicUrl,
    ).toBe("https://private.example.com");
  });

  it.each(["", "relative", "ftp://private.example.com"])(
    "rejects an invalid environment public URL: %s",
    (publicUrl) => {
      vi.stubEnv("ACTUAL_UP_PUBLIC_URL", publicUrl);
      expect(() => parseConfig(base)).toThrow();
    },
  );

  it("applies safe defaults", () => {
    const config = parseConfig(base);
    expect(config.schedule).toEqual({
      backfillCron: "0 3 * * *",
      cron: "*/15 * * * *",
      enabled: true,
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
