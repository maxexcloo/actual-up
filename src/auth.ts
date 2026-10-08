import { createHash, timingSafeEqual } from "node:crypto";

/** Compare fixed-length digests without exposing credential values. */
export function authorised(
  header: string | undefined,
  username: string,
  password: string,
): boolean {
  if (!header?.startsWith("Basic ")) return false;
  const supplied = Buffer.from(header.slice(6), "base64");
  const expected = Buffer.from(`${username}:${password}`);
  return timingSafeEqual(
    createHash("sha256").update(supplied).digest(),
    createHash("sha256").update(expected).digest(),
  );
}
