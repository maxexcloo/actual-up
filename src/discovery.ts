import type { ActualClient, UpClientLike } from "./types.js";

export async function discoverActualAccounts(actual: Pick<ActualClient, "getAccounts">) {
  return (await actual.getAccounts()).map(({ id, name }) => ({ id, name }));
}

export async function discoverUpAccounts(client: Pick<UpClientLike, "listAccounts">) {
  return (await client.listAccounts()).map(({ id, attributes }) => ({
    id,
    name: attributes.displayName,
  }));
}
