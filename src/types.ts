import type * as actual from "@actual-app/api";

export type UpAccount = {
  id: string;
  attributes: {
    accountType: "HOME_LOAN" | "SAVER" | "TRANSACTIONAL";
    balance: UpMoney;
    displayName: string;
    ownershipType: "INDIVIDUAL" | "JOINT";
  };
};

export type UpMoney = {
  currencyCode: string;
  value: string;
  valueInBaseUnits: number;
};

export type UpTransaction = {
  id: string;
  attributes: {
    amount: UpMoney;
    cashback?: { amount: UpMoney; description: string } | null;
    createdAt: string;
    description: string;
    foreignAmount?: UpMoney | null;
    holdInfo?: { amount: UpMoney; foreignAmount?: UpMoney | null } | null;
    message?: string | null;
    note?: { text: string } | string | null;
    performingCustomer?: { displayName: string } | null;
    rawText?: string | null;
    roundUp?: { amount: UpMoney; boostPortion?: UpMoney | null } | null;
    settledAt?: string | null;
    status: "HELD" | "SETTLED";
  };
  relationships: {
    account: { data: { id: string; type: "accounts" } };
    category?: { data: { id: string; type: "categories" } | null };
    transferAccount?: { data: { id: string; type: "accounts" } | null };
  };
};

type Item<T extends (...args: never[]) => Promise<unknown[]>> = Awaited<ReturnType<T>>[number];

export type ActualAccount = Item<typeof actual.getAccounts>;
export type ActualCategory = Item<typeof actual.getCategories>;
export type ActualPayee = Item<typeof actual.getPayees>;
export type ActualTransaction = Item<typeof actual.getTransactions>;
/** Every Up import carries its amount and `up:` identity. */
export type ActualImportTransaction = Parameters<typeof actual.importTransactions>[1][number] & {
  amount: number;
  imported_id: string;
};
export type ActualImportResult = Pick<
  Awaited<ReturnType<typeof actual.importTransactions>>,
  "added" | "errors" | "updated"
>;

export interface ActualClient {
  close(): Promise<void>;
  deleteTransaction(id: string): Promise<void>;
  getAccounts(): Promise<ActualAccount[]>;
  getCategories(): Promise<ActualCategory[]>;
  getPayees(): Promise<ActualPayee[]>;
  getServerVersion(): Promise<string>;
  getTransactions(
    accountId: string,
    startDate: string,
    endDate: string,
  ): Promise<ActualTransaction[]>;
  importTransactions(
    accountId: string,
    transactions: ActualImportTransaction[],
  ): Promise<ActualImportResult>;
  open(): Promise<void>;
  sync(): Promise<void>;
  updateTransaction(id: string, fields: Partial<ActualTransaction>): Promise<void>;
}

export interface UpClientLike {
  listAccounts(): Promise<UpAccount[]>;
  listTransactions(accountId: string, since: string): Promise<UpTransaction[]>;
  ping(): Promise<void>;
}
