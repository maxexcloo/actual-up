import { createHash, timingSafeEqual } from "node:crypto";

const digest = (value: string) => createHash("sha256").update(value).digest();

/** Credential verification and bounded login throttling. */
export class LoginAttempts {
  private readonly attempts = new Map<
    string,
    { count: number; until: number }
  >();

  constructor(
    private readonly username: string,
    private readonly password: string,
  ) {}

  login(
    username: string,
    password: string,
    address: string,
  ): { valid?: boolean; limited?: boolean } {
    const now = Date.now();
    for (const [key, value] of this.attempts)
      if (value.until <= now) this.attempts.delete(key);
    const attempt = this.attempts.get(address) ?? {
      count: 0,
      until: now + 15 * 60 * 1000,
    };
    if (
      attempt.count >= 10 ||
      (!this.attempts.has(address) && this.attempts.size >= 1000)
    )
      return { limited: true };
    // Evaluate both comparisons even if the username is wrong.
    const userMatches = timingSafeEqual(
      digest(username),
      digest(this.username),
    );
    const passwordMatches = timingSafeEqual(
      digest(password),
      digest(this.password),
    );
    if (!userMatches || !passwordMatches) {
      attempt.count++;
      this.attempts.set(address, attempt);
      return {};
    }
    this.attempts.delete(address);
    return { valid: true };
  }
}
