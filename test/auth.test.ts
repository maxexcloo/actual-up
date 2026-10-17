import { afterEach, describe, expect, it, vi } from "vitest";
import { LoginAttempts } from "../src/auth.js";

afterEach(() => vi.useRealTimers());
describe("sessions", () => {
  it("limits failed login attempts without leaking which credential was wrong", () => {
    vi.useFakeTimers();
    const sessions = new LoginAttempts("test", "test");
    for (let i = 0; i < 10; i++) expect(sessions.login("wrong", "test", "local")).toEqual({});
    expect(sessions.login("test", "test", "local")).toEqual({ limited: true });
    vi.advanceTimersByTime(15 * 60 * 1000 + 1);
    expect(sessions.login("test", "test", "local").valid).toBe(true);
  });
});
