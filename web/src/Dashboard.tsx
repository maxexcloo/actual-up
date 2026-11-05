import { Badge, Stack } from "@mantine/core";
import type { AppState } from "../../src/api.js";
import { AccountsCard } from "./AccountsCard";
import { scheduleLabel } from "./format";
import { LogsCard } from "./LogsCard";
import { SectionHeader } from "./SectionHeader";
import { SettingsCard } from "./SettingsCard";
import { SyncStatus } from "./SyncStatus";

export function Dashboard({ state, refresh }: { state: AppState; refresh: () => void }) {
  const { schedule } = state;
  return (
    <Stack gap="xl" pt="md">
      <SectionHeader
        order={1}
        title="Accounts & Sync"
        description={
          schedule.enabled
            ? `Up → Actual Budget · ${scheduleLabel(schedule.cron)} · Backfill ${scheduleLabel(schedule.backfillCron)} · ${schedule.timezone}`
            : "Up → Actual Budget"
        }
      >
        <Badge variant="light" color={schedule.enabled ? "green" : "amber"}>
          {schedule.enabled ? "Automatic Sync On" : "Automatic Sync Off"}
        </Badge>
      </SectionHeader>
      {state.actual.configured && <SyncStatus state={state} refresh={refresh} />}
      {state.actual.configured && <AccountsCard state={state} refresh={refresh} />}
      <SettingsCard state={state} refresh={refresh} />
      <LogsCard logs={state.logs} timezone={schedule.timezone} />
    </Stack>
  );
}
