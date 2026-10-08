import { afterEach, describe, expect, it, vi } from "vitest";
import { Sessions } from "../src/auth.js";

afterEach(() => vi.useRealTimers());
describe("sessions", () => {
  it("uses secure opaque cookies, expires sessions and invalidates logout", () => {
    vi.useFakeTimers();
    const sessions = new Sessions("test", "test", true);
    const cookie = sessions.login("test", "test", "local").cookie!;
    expect(cookie).toContain("HttpOnly; SameSite=Strict");
    expect(cookie).toContain("; Secure");
    expect(cookie).not.toContain("test");
    expect(sessions.valid(cookie)).toBe(true);
    expect(sessions.valid("actual_up_session=forged")).toBe(false);
    vi.advanceTimersByTime(8 * 60 * 60 * 1000 + 1);
    expect(sessions.valid(cookie)).toBe(false);
    const next = sessions.login("test", "test", "local").cookie!;
    sessions.logout(next);
    expect(sessions.valid(next)).toBe(false);
  });
  it("limits failed login attempts without leaking which credential was wrong", () => {
    vi.useFakeTimers();
    const sessions = new Sessions("test", "test", false);
    for (let i = 0; i < 10; i++)
      expect(sessions.login("wrong", "test", "local")).toEqual({});
    expect(sessions.login("test", "test", "local")).toEqual({ limited: true });
    vi.advanceTimersByTime(15 * 60 * 1000 + 1);
    expect(sessions.login("test", "test", "local").cookie).toBeDefined();
  });
});
