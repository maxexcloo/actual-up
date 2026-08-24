//native
import { createRuntime } from "./runtime";

export async function main() {
  const { engine } = await createRuntime();
  return { ok: true, ...(await engine.validate()) };
}
