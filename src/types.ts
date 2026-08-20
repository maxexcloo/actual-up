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

export type UpWebhookEvent = {
  data: {
    attributes: {
      createdAt: string;
      eventType:
        | "PING"
        | "TRANSACTION_CREATED"
        | "TRANSACTION_DELETED"
        | "TRANSACTION_SETTLED";
    };
    id: string;
    relationships: {
      transaction?: { data: { id: string; type: "transactions" } | null };
      webhook: { data: { id: string; type: "webhooks" } };
    };
    type: "webhook-events";
  };
};

export type ActualAccount = {
  closed?: boolean;
  id: string;
  name: string;
  offbudget?: boolean;
};

export type ActualCategory = {
  hidden?: boolean;
  id: string;
  name: string;
};

export type ActualPayee = {
  id: string;
  name: string;
  transfer_acct?: string;
};

export type ActualTransaction = {
  account: string;
  amount: number;
  category?: string;
  cleared?: boolean;
  date: string;
  id: string;
  imported_id?: string;
  imported_payee?: string;
  is_child?: boolean;
  is_parent?: boolean;
  notes?: string;
  payee?: string | null;
  reconciled?: boolean;
  subtransactions?: ActualTransaction[];
  transfer_id?: string;
};

export type ActualImportTransaction = {
  account: string;
  amount: number;
  category?: string;
  cleared: boolean;
  date: string;
  imported_id: string;
  imported_payee: string;
  notes?: string;
  payee?: string | null;
  payee_name?: string;
};

export type ActualImportResult = {
  added: string[];
  errors: Array<{ message: string }>;
  updated: string[];
};

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
  importTransaction(
    accountId: string,
    transaction: ActualImportTransaction,
  ): Promise<ActualImportResult>;
  open(): Promise<void>;
  sync(): Promise<void>;
  updateTransaction(
    id: string,
    fields: Partial<ActualTransaction>,
  ): Promise<void>;
}

export interface UpClientLike {
  createWebhook(url: string, description: string): Promise<UpWebhook>;
  deleteWebhook(id: string): Promise<void>;
  getTransaction(id: string): Promise<UpTransaction>;
  listAccounts(): Promise<UpAccount[]>;
  listTransactions(accountId: string, since: string): Promise<UpTransaction[]>;
  listWebhooks(): Promise<UpWebhook[]>;
  ping(): Promise<void>;
  pingWebhook(id: string): Promise<void>;
}

export type UpWebhook = {
  id: string;
  attributes: {
    createdAt: string;
    description?: string | null;
    secretKey?: string;
    url: string;
  };
};
