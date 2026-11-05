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

export type LogEntry = {
  time: string;
  level: "debug" | "info" | "warn" | "error";
  message: string;
  /** Safe context fields, such as the account alias or connection. */
  context?: string;
};

export type AppState = {
  /** Changes whenever any other field changes. */
  version: string;
  /** Form revisions; a save from an older revision is rejected. */
  revisions: { mappings: string; settings: string };
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
  };
  connections: string[];
  /** Unset until discovery has read Actual. */
  actualAccounts?: Array<{ id: string; name: string }>;
  /** Set when the last discovery could not read Actual or these connections. */
  unavailable: { actual: boolean; connections: string[] };
  accounts: Array<{
    id: string;
    name: string;
    /** Every connection that can read the account, mapped or discovered. */
    connections: string[];
    mapping?: { alias: string; actualAccountId: string; connections: string[] };
  }>;
  jobs: Job[];
  logs: LogEntry[];
};

export type ActionResponse = { accepted: boolean; message: string };
