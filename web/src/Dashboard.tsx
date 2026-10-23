import { Accordion, Alert, Badge, Button, Card, Group, Stack, Text } from "@mantine/core";
import type { AppState } from "../../src/api.js";
import { ActionButton } from "./ActionButton";
import { ActualSection } from "./ActualSection";
import { AddConnection, ConnectionSection } from "./ConnectionSection";
import { scheduleLabel } from "./format";
import { save } from "./settings";
import { SectionHeader } from "./SectionHeader";
import { SyncStatus } from "./SyncStatus";

export function Dashboard({ state, refresh }: { state: AppState; refresh: () => void }) {
  const { schedule } = state;
  return (
    <Stack gap="xl" pt="md">
      <SectionHeader
        order={1}
        title="Accounts & Sync"
        description={`Up → Actual Budget · Regular sync checks the last ${schedule.lookbackDays} days.`}
      >
        <Badge variant="light" color={schedule.enabled ? "green" : "amber"}>
          {schedule.enabled ? "Automatic Sync On" : "Automatic Sync Off"}
        </Badge>
        <ActionButton
          path="/actions/sync"
          body={{ mode: "live" }}
          refresh={refresh}
          disabled={!state.accounts.some(({ mapping }) => mapping)}
        >
          Sync All
        </ActionButton>
      </SectionHeader>
      {(state.busy || state.message) && (
        <Alert color="gray" role="status" aria-live="polite">
          {state.busy ? "Updating connections…" : state.message}
        </Alert>
      )}
      <SyncStatus state={state} refresh={refresh} />
      <ActualSection state={state} refresh={refresh} />
      {state.connections.map((connection) => (
        <ConnectionSection
          key={connection.id}
          state={state}
          connection={connection}
          refresh={refresh}
        />
      ))}
      <AddConnection state={state} refresh={refresh} />
      <Card>
        <Accordion>
          <Accordion.Item value="tools">
            <Accordion.Control>Automation &amp; Tools</Accordion.Control>
            <Accordion.Panel>
              <Stack>
                <Text size="sm">
                  Recent Sync: {scheduleLabel(schedule.cron)} · Full Backfill:{" "}
                  {scheduleLabel(schedule.backfillCron)} · {schedule.timezone}
                </Text>
                <Group gap="xs">
                  <Button
                    variant="default"
                    disabled={state.busy}
                    onClick={async () => {
                      await save({ action: "discover", revision: state.revision });
                      refresh();
                    }}
                  >
                    Refresh Accounts
                  </Button>
                  <ActionButton path="/actions/validate" refresh={refresh} variant="default">
                    Check Connections
                  </ActionButton>
                </Group>
              </Stack>
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
      </Card>
    </Stack>
  );
}
