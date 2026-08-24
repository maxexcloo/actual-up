//native
import { createRuntime } from "./runtime";

export async function main() {
  const { actual, clients } = await createRuntime();
  return {
    actual: {
      accounts: await actual.getAccounts(),
      categories: await actual.getCategories(),
    },
    up: Object.fromEntries(
      await Promise.all(
        [...clients].map(async ([id, client]) => [
          id,
          (await client.listAccounts()).map(
            ({ attributes, id: accountId }) => ({
              accountType: attributes.accountType,
              displayName: attributes.displayName,
              id: accountId,
              ownershipType: attributes.ownershipType,
            }),
          ),
        ]),
      ),
    ),
  };
}
