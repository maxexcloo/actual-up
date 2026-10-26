// JSON shapes shared by the server and the browser; types only.

export type JobState = "queued" | "running" | "success" | "warning" | "failure";

export type JobProgress = {
  account?: string;
  completed?: number;
  stage: string;
  total?: number;
};

export type JobScope = {
  account?: string;
  connection?: string;
  mode?: "dry-run" | "live";
  since?: string;
  target?: string;
};

export type Job = {
  id: string;
  trigger: string;
  state: JobState;
  startedAt?: string;
  finishedAt?: string;
  result?: unknown;
  progress?: JobProgress;
  scope?: JobScope;
};

export type SyncCounts = {
  conflicts: number;
  deleted: number;
  failed: number;
  imported: number;
  inspected: number;
  unchanged: number;
  updated: number;
};

export type AccountIssue = "actual-unavailable" | "actual-write-failed" | "up-unavailable";

export type SyncReport = SyncCounts & {
  accounts: Array<SyncCounts & { account: string; issue?: AccountIssue }>;
  preview: boolean;
  publication: "not-required" | "pending" | "published" | "failed";
};

export type AccountUpdate = {
  pending: boolean;
  message: string;
  failed?: boolean;
};

export type ConnectionStatus = "connected" | "attention" | "configured" | "setup" | "unchecked";

export type AppState = {
  /** Changes whenever any other field changes. */
  version: string;
  /** Settings revision for connection and Actual changes. */
  revision: string;
  busy: boolean;
  message: string;
  schedule: {
    enabled: boolean;
    lookbackDays: number;
    cron: string;
    backfillCron: string;
    timezone: string;
    nextRun?: string;
  };
  actual: {
    serverUrl: string;
    syncId: string;
    method: "session" | "password";
    configured: boolean;
    encryptionPassword: boolean;
    status: ConnectionStatus;
    test?: JobState;
  };
  /** Unset until discovery has read Actual. */
  actualAccounts?: Array<{ id: string; name: string }>;
  connections: Array<{ id: string; status: ConnectionStatus; test?: JobState }>;
  accounts: Array<{
    id: string;
    name: string;
    /** Every connection that can read the account, mapped or discovered. */
    connections: string[];
    revision: string;
    mapping?: {
      alias: string;
      actualAccountId: string;
      actualAccountName?: string;
      connections: string[];
    };
    update?: AccountUpdate;
  }>;
  jobs: Job[];
};

export type ActionResponse = { accepted: boolean; message: string };
export type ErrorResponse = { error: string };
