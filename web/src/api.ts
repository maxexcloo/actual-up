import { notifications } from "@mantine/notifications";

export const signedOutEvent = "actual-up:signed-out";

export type Result = { ok: true; message: string } | { ok: false; error: string };

/** Post JSON to the app and normalise its replies; a lost session returns to sign-in. */
export async function send(path: string, body: object = {}): Promise<Result> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, error: "The app is unreachable. Check your connection and retry." };
  }
  if (response.status === 401 && path !== "/login") window.dispatchEvent(new Event(signedOutEvent));
  const data: { accepted?: boolean; error?: string; message?: string } =
    response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok || data.accepted === false)
    return { ok: false, error: data.error ?? data.message ?? "Request failed. Try again." };
  return { ok: true, message: data.message ?? "" };
}

/** Run an action and report its outcome as a notification. */
export async function run(path: string, body: object = {}): Promise<boolean> {
  const result = await send(path, body);
  notifications.show(
    result.ok
      ? { color: "green", message: result.message || "Done." }
      : { color: "red", message: result.error },
  );
  return result.ok;
}
