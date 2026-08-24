import React, { useCallback, useEffect, useState } from "react";
import { backend } from "./wmill";
import "./index.css";

type Action = "discover" | "sync-dry-run" | "sync-live" | "validate";
type Report = {
  conflicts: number;
  deleted: number;
  failed: number;
  imported: number;
  inspected: number;
  updated: number;
};
type Dashboard = {
  config: {
    actualBridgeUrl: string | null;
    connectionCount: number;
    connections: Array<{ hasWebhook: boolean; id?: string }>;
    lookbackDays: number;
    mappingCount: number;
    timezone: string;
  };
  state: {
    finishedAt: string | null;
    jobId: string | null;
    report: Report | null;
    trigger: string | null;
  };
};

const emptyDashboard: Dashboard = {
  config: {
    actualBridgeUrl: null,
    connectionCount: 0,
    connections: [],
    lookbackDays: 30,
    mappingCount: 0,
    timezone: "Australia/Sydney",
  },
  state: { finishedAt: null, jobId: null, report: null, trigger: null },
};

export default function App() {
  const [dashboard, setDashboard] = useState<Dashboard>(emptyDashboard);
  const [busy, setBusy] = useState<Action | null>(null);
  const [message, setMessage] = useState("Ready");
  const [result, setResult] = useState<unknown>(null);

  const refresh = useCallback(async () => {
    try {
      setDashboard((await backend.status({})) as Dashboard);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not load status",
      );
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function run(action: Action) {
    if (
      action === "sync-live" &&
      !window.confirm("Write these Up transactions to Actual now?")
    )
      return;
    setBusy(action);
    setMessage(`Running ${label(action)}…`);
    try {
      const value = await backend.action({ action });
      setResult(value);
      setMessage(`${label(action)} completed`);
      await refresh();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : `${label(action)} failed`,
      );
    } finally {
      setBusy(null);
    }
  }

  const report = dashboard.state.report;
  return (
    <main>
      <header className="hero">
        <div>
          <p className="eyebrow">UP → ACTUAL</p>
          <h1>Money, reconciled.</h1>
          <p className="lede">
            One quiet control room for scheduled imports, Up webhooks and
            shared-account mappings.
          </p>
        </div>
        <div className="status-pill">
          <span />
          {message}
        </div>
      </header>

      <section className="metrics" aria-label="Last synchronisation">
        <Metric label="Imported" value={report?.imported} />
        <Metric label="Updated" value={report?.updated} />
        <Metric label="Inspected" value={report?.inspected} />
        <Metric
          label="Conflicts"
          value={report?.conflicts}
          warn={Boolean(report?.conflicts)}
        />
        <Metric
          label="Failed"
          value={report?.failed}
          warn={Boolean(report?.failed)}
        />
      </section>

      <div className="grid">
        <section className="panel actions-panel">
          <div className="panel-heading">
            <div>
              <p className="kicker">Actions</p>
              <h2>Run deliberately</h2>
            </div>
            <button className="text-button" onClick={() => void refresh()}>
              Refresh
            </button>
          </div>
          <div className="button-grid">
            <ActionButton
              action="validate"
              busy={busy}
              onRun={run}
              description="Credentials and mappings"
            />
            <ActionButton
              action="discover"
              busy={busy}
              onRun={run}
              description="Accounts and categories"
            />
            <ActionButton
              action="sync-dry-run"
              busy={busy}
              onRun={run}
              description="Preview without writes"
            />
            <ActionButton
              action="sync-live"
              busy={busy}
              onRun={run}
              description="Write changes to Actual"
              primary
            />
          </div>
        </section>

        <section className="panel">
          <p className="kicker">Configuration</p>
          <h2>Connected system</h2>
          <dl>
            <Row
              label="Actual"
              value={dashboard.config.actualBridgeUrl ?? "Not configured"}
            />
            <Row
              label="Mappings"
              value={String(dashboard.config.mappingCount)}
            />
            <Row
              label="Lookback"
              value={`${dashboard.config.lookbackDays} days`}
            />
            <Row label="Timezone" value={dashboard.config.timezone} />
          </dl>
          <div className="connections">
            {dashboard.config.connections.map((connection) => (
              <span className="connection" key={connection.id}>
                {connection.id ?? "unnamed"}
                <i className={connection.hasWebhook ? "online" : ""} />
              </span>
            ))}
          </div>
          <p className="hint">
            Edit secrets and mappings in the <code>f/actual_up/config</code>{" "}
            Windmill resource.
          </p>
        </section>
      </div>

      <section className="panel run-panel">
        <div className="panel-heading">
          <div>
            <p className="kicker">Last run</p>
            <h2>{formatDate(dashboard.state.finishedAt)}</h2>
          </div>
          <span className="trigger">
            {dashboard.state.trigger ?? "No run yet"}
          </span>
        </div>
        <pre>
          {result
            ? JSON.stringify(result, null, 2)
            : "Run an action to inspect its safe result here."}
        </pre>
      </section>
    </main>
  );
}

function Metric({
  label,
  value,
  warn = false,
}: {
  label: string;
  value?: number;
  warn?: boolean;
}) {
  return (
    <article className={warn ? "metric warn" : "metric"}>
      <strong>{value ?? "—"}</strong>
      <span>{label}</span>
    </article>
  );
}

function ActionButton({
  action,
  busy,
  description,
  onRun,
  primary = false,
}: {
  action: Action;
  busy: Action | null;
  description: string;
  onRun: (action: Action) => Promise<void>;
  primary?: boolean;
}) {
  return (
    <button
      className={primary ? "action primary" : "action"}
      disabled={busy !== null}
      onClick={() => void onRun(action)}
    >
      <strong>{busy === action ? "Running…" : label(action)}</strong>
      <span>{description}</span>
    </button>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function label(action: Action) {
  return {
    discover: "Discover",
    "sync-dry-run": "Dry run",
    "sync-live": "Sync now",
    validate: "Validate",
  }[action];
}

function formatDate(value: string | null) {
  if (!value) return "Nothing synchronised yet";
  return new Intl.DateTimeFormat("en-AU", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
