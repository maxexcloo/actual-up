import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const lifetime = 8 * 60 * 60 * 1000;
const cookieName = "actual_up_session";
const digest = (value: string) => createHash("sha256").update(value).digest();

/** Opaque, server-side sessions expire on restart; no credentials enter cookies. */
export class Sessions {
  private readonly sessions = new Map<string, number>();
  private readonly attempts = new Map<
    string,
    { count: number; until: number }
  >();

  constructor(
    private readonly username: string,
    private readonly password: string,
    private readonly secure: boolean,
  ) {}

  private token(cookie: string | undefined): string | undefined {
    return cookie
      ?.split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${cookieName}=`))
      ?.slice(cookieName.length + 1);
  }

  valid(cookie: string | undefined): boolean {
    const token = this.token(cookie);
    if (!token) return false;
    const hash = digest(token).toString("hex");
    const expires = this.sessions.get(hash);
    if (expires && expires > Date.now()) return true;
    this.sessions.delete(hash);
    return false;
  }

  login(
    username: string,
    password: string,
    address: string,
  ): { cookie?: string; limited?: boolean } {
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
    for (const [key, expires] of this.sessions)
      if (expires <= now) this.sessions.delete(key);
    if (this.sessions.size >= 100)
      this.sessions.delete(this.sessions.keys().next().value!);
    const token = randomBytes(32).toString("base64url");
    this.sessions.set(digest(token).toString("hex"), now + lifetime);
    return { cookie: this.cookie(token, lifetime / 1000) };
  }

  logout(cookie: string | undefined): string {
    const token = this.token(cookie);
    if (token) this.sessions.delete(digest(token).toString("hex"));
    return this.cookie("", 0);
  }

  private cookie(token: string, age: number): string {
    return `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${this.secure ? "; Secure" : ""}`;
  }
}
