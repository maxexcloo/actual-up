import {
  Accordion,
  Alert,
  Badge,
  Button,
  Card,
  List,
  SimpleGrid,
  Stack,
  Text,
} from "@mantine/core";
import { useInterval } from "@mantine/hooks";
import { useEffect, useState } from "react";
import type { AppState, Job } from "../../src/api.js";
import { HISTORY_START } from "../../src/schemas.js";
import { run } from "./api";
import {
  accountIssues,
  connectionName,
  elapsed,
  formatTime,
  isReport,
  plural,
  reportFields,
  stateColour,
  stateLabel,
  summarise,
  syncTriggers,
  triggerLabel,
  type SyncReport,
} from "./format";
import { SectionHeader } from "./SectionHeader";

export function SyncStatus({ state, refresh }: { state: AppState; refresh: () => void }) {
  const { timezone } = state.schedule;
  const summary = summarise(state.jobs);
  const [now, setNow] = useState(() => Date.now());
  const ticker = useInterval(() => setNow(Date.now()), 1000);
  useEffect(() => {
    if (summary.active) ticker.start();
    else ticker.stop();
    return ticker.stop;
  }, [summary.active, ticker]);
  const { active } = summary;
  return (
    <Card aria-label="Sync Status">
      <Stack>
        <SectionHeader
          title={summary.heading}
          description={[
            `Last Successful Sync: ${summary.lastSuccess ? formatTime(summary.lastSuccess.finishedAt, timezone) : "None in recent activity"}`,
            `Automatic Sync ${state.schedule.enabled ? "On" : "Off"}`,
            state.schedule.nextRun &&
              `Next Recent Sync: ${formatTime(state.schedule.nextRun, timezone)}`,
          ]
            .filter(Boolean)
            .join(" · ")}
        >
          <Badge variant="light" color={stateColour(summary.state)}>
            {stateLabel(summary.state)}
          </Badge>
        </SectionHeader>
        <Stack gap={4} role="status" aria-live="polite">
          {active && (
            <Text>
              {[
                active.progress?.stage ?? "Starting",
                active.progress?.account,
                `Started ${formatTime(active.startedAt, timezone)}`,
                active.startedAt && `${elapsed(active.startedAt, now)} elapsed`,
                active.progress?.total !== undefined &&
                  `${active.progress.completed ?? 0} of ${active.progress.total} accounts processed`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </Text>
          )}
          {summary.queued > 0 && <Text>{plural(summary.queued, "queued operation")}.</Text>}
        </Stack>
        {summary.latest ? (
          <JobDetails job={summary.latest} timezone={timezone} refresh={refresh} />
        ) : (
          <Text c="dimmed">Your first sync result will appear here.</Text>
        )}
        {summary.recent.length > 0 && (
          <Accordion variant="contained">
            <Accordion.Item value="activity">
              <Accordion.Control>
                Recent Activity · {plural(summary.recent.length, "Run")}
              </Accordion.Control>
              <Accordion.Panel>
                <Stack>
                  <Accordion variant="separated">
                    {summary.recent.map((job) => (
                      <Accordion.Item key={job.id} value={job.id}>
                        <Accordion.Control>
                          {triggerLabel(job.trigger)} ·{" "}
                          {formatTime(job.finishedAt ?? job.startedAt, timezone)} ·{" "}
                          {stateLabel(job.state)}
                        </Accordion.Control>
                        <Accordion.Panel>
                          <JobDetails job={job} timezone={timezone} refresh={refresh} />
                        </Accordion.Panel>
                      </Accordion.Item>
                    ))}
                  </Accordion>
                  <Text size="sm" c="dimmed">
                    Activity and last-success times reset when the app restarts.
                  </Text>
                </Stack>
              </Accordion.Panel>
            </Accordion.Item>
          </Accordion>
        )}
      </Stack>
    </Card>
  );
}

function JobDetails({
  job,
  timezone,
  refresh,
}: {
  job: Job;
  timezone: string;
  refresh: () => void;
}) {
  const scope = job.scope ?? {};
  const retryable = syncTriggers.has(job.trigger) && ["failure", "warning"].includes(job.state);
  return (
    <Stack gap="sm">
      <Text>
        {[
          triggerLabel(job.trigger),
          scope.account ||
            (scope.connection && connectionName(scope.connection)) ||
            (syncTriggers.has(job.trigger) ? "All Accounts" : "Connections"),
          formatTime(job.finishedAt ?? job.startedAt, timezone),
          scope.since && `From ${scope.since}`,
        ]
          .filter(Boolean)
          .join(" · ")}
      </Text>
      {job.state === "failure" && job.result === undefined && (
        <Alert color="red" role="alert">
          The operation could not complete. Test the saved connections, check the account mapping
          and retry. No completed result was received.
        </Alert>
      )}
      {job.result !== undefined && <JobResult result={job.result} />}
      {retryable && (
        <Button
          variant="default"
          w="fit-content"
          onClick={async () => {
            await run("/actions/sync", {
              mode: scope.mode ?? "live",
              account: scope.account ?? "",
              connection: scope.connection ?? "",
              since: scope.since ?? (job.trigger === "automatic-backfill" ? HISTORY_START : ""),
            });
            refresh();
          }}
        >
          Retry {scope.account || "Sync"}
        </Button>
      )}
    </Stack>
  );
}

const proposed: Record<string, string> = {
  imported: "Would Import",
  updated: "Would Update",
  deleted: "Would Delete",
};

function JobResult({ result }: { result: unknown }) {
  if (!isReport(result)) {
    if (typeof result === "object" && result !== null && "ok" in result && result.ok === true)
      return <Text>Operation completed successfully.</Text>;
    return null;
  }
  const report: SyncReport = result;
  const preview = report.preview === true;
  return (
    <Stack gap="sm">
      {preview && (
        <Text>
          Preview only. No import changes were applied. Estimates compare bank-owned fields and
          category mappings; Actual matching and rules run during a live sync.
        </Text>
      )}
      <SimpleGrid cols={{ base: 3, xs: 4 }} spacing="xs">
        {reportFields
          .filter((key) => typeof report[key] === "number")
          .map((key) => (
            <Stack key={key} gap={0}>
              <Text size="xs" c="dimmed">
                {preview && proposed[key]
                  ? proposed[key]
                  : key.charAt(0).toUpperCase() + key.slice(1)}
              </Text>
              <Text fw={600}>{report[key]}</Text>
            </Stack>
          ))}
      </SimpleGrid>
      {report.publication === "published" && (
        <Alert color="green">Changes published to Actual.</Alert>
      )}
      {report.publication === "failed" && (
        <Alert color="red" role="alert">
          Publishing to Actual failed. Some changes may be saved locally; retry the sync to publish
          them.
        </Alert>
      )}
      {Number(report.conflicts) > 0 && (
        <Alert color="amber" role="status">
          Protected Actual edits were retained. Review the affected accounts in Actual; retrying
          will preserve those edits again.
        </Alert>
      )}
      {report.accounts && (
        <List size="sm">
          {report.accounts.map((entry) => (
            <List.Item key={entry.account}>
              {entry.account}:{" "}
              {entry.failed
                ? (accountIssues[entry.issue ?? ""] ?? "Sync failed; test connections and retry.")
                : `${entry.imported} ${preview ? "would import" : "imported"}, ${entry.updated} ${preview ? "would update" : "updated"}, ${entry.unchanged} unchanged, ${entry.deleted} ${preview ? "would delete" : "deleted"}`}
              {entry.conflicts ? ` · ${entry.conflicts} protected deletion conflicts` : ""}
            </List.Item>
          ))}
        </List>
      )}
    </Stack>
  );
}
