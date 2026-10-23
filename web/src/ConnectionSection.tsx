import {
  Accordion,
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Divider,
  Fieldset,
  Group,
  PasswordInput,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { Fragment, useState } from "react";
import type { AppState } from "../../src/api.js";
import { connectionForm, HISTORY_START, mappingForm } from "../../src/schemas.js";
import { ActionButton } from "./ActionButton";
import { run } from "./api";
import { connectionName, plural } from "./format";
import { SectionHeader } from "./SectionHeader";
import { confirm, save, StatusBadge, TestResult } from "./settings";
import { useSettingsForm } from "./useSettingsForm";

type Account = AppState["accounts"][number];
type Connection = AppState["connections"][number];

export function ConnectionSection({
  state,
  connection,
  refresh,
}: {
  state: AppState;
  connection: Connection;
  refresh: () => void;
}) {
  const accounts = state.accounts.filter(({ connections }) => connections.includes(connection.id));
  const inUse = accounts.some(({ mapping }) => mapping?.connections.includes(connection.id));
  return (
    <Card data-connection={connection.id}>
      <Stack>
        <SectionHeader
          title={connectionName(connection.id)}
          description={`Up · ${plural(accounts.length, "Account")}`}
        >
          <StatusBadge status={connection.status} />
          <ActionButton
            path="/actions/test"
            body={{ target: "up", connection: connection.id }}
            refresh={refresh}
            variant="subtle"
            size="xs"
          >
            Test
          </ActionButton>
          <ActionButton
            path="/actions/sync"
            body={{ mode: "live", connection: connection.id }}
            refresh={refresh}
            variant="light"
            size="xs"
            disabled={!inUse}
          >
            Sync All
          </ActionButton>
        </SectionHeader>
        <TestResult state={connection.test} />
        <Accordion variant="contained">
          <Accordion.Item value="settings">
            <Accordion.Control>Connection Settings</Accordion.Control>
            <Accordion.Panel>
              <Stack>
                <ConnectionForm state={state} id={connection.id} refresh={refresh} />
                {inUse ? (
                  <Text size="sm" c="dimmed">
                    Disconnect its accounts before removing this connection.
                  </Text>
                ) : (
                  <Button
                    color="red"
                    variant="light"
                    w="fit-content"
                    disabled={state.busy}
                    onClick={() =>
                      confirm(
                        "Remove Connection",
                        "Remove this connection and its saved API key?",
                        "Remove Connection",
                        async () => {
                          await save({
                            action: "remove-connection",
                            revision: state.revision,
                            id: connection.id,
                          });
                          refresh();
                        },
                      )
                    }
                  >
                    Remove Connection
                  </Button>
                )}
              </Stack>
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
        {accounts.length ? (
          accounts.map((account) => (
            <Fragment key={account.id}>
              <Divider />
              <AccountRow state={state} account={account} refresh={refresh} />
            </Fragment>
          ))
        ) : (
          <Text size="sm" c="dimmed">
            Accounts will appear here after discovery.
          </Text>
        )}
      </Stack>
    </Card>
  );
}

/** Add a connection, or replace the key of an existing one. */
function ConnectionForm({
  state,
  id,
  refresh,
}: {
  state: AppState;
  id?: string;
  refresh: () => void;
}) {
  const { form, submit } = useSettingsForm(
    connectionForm,
    { id: id ?? "", token: "" },
    state.revision,
  );
  return (
    <form
      onSubmit={submit(async (values, revision) => {
        const saved = await save({ action: "connection", revision, ...values });
        refresh();
        return saved;
      })}
    >
      <Fieldset variant="unstyled" disabled={state.busy}>
        <Stack>
          <SimpleGrid cols={{ base: 1, sm: id ? 1 : 2 }}>
            {!id && (
              <TextInput
                label="Name"
                placeholder="e.g. max"
                maxLength={80}
                key={form.key("id")}
                {...form.getInputProps("id")}
              />
            )}
            <PasswordInput
              label={id ? "Replace API Key" : "Up API Key"}
              autoComplete="new-password"
              maxLength={8192}
              key={form.key("token")}
              {...form.getInputProps("token")}
            />
          </SimpleGrid>
          {!id && (
            <Text size="sm" c="dimmed">
              Use a short name with lowercase letters, numbers or hyphens. Your key is encrypted and
              accounts are discovered automatically.
            </Text>
          )}
          <Button type="submit" w="fit-content" loading={form.submitting}>
            {id ? "Save Key" : "Add Connection"}
          </Button>
        </Stack>
      </Fieldset>
    </form>
  );
}

export function AddConnection({ state, refresh }: { state: AppState; refresh: () => void }) {
  return (
    <Card>
      <Accordion defaultValue={state.connections.length ? null : "add"}>
        <Accordion.Item value="add">
          <Accordion.Control>Add Connection</Accordion.Control>
          <Accordion.Panel>
            <ConnectionForm state={state} refresh={refresh} />
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
    </Card>
  );
}

function AccountRow({
  state,
  account,
  refresh,
}: {
  state: AppState;
  account: Account;
  refresh: () => void;
}) {
  const { mapping, update } = account;
  return (
    <Stack data-account={account.id}>
      <Group justify="space-between" align="flex-start">
        <Stack gap={2}>
          <Group gap="xs">
            <Title order={4}>{mapping?.alias ?? account.name}</Title>
            {account.connections.length > 1 && (
              <Badge variant="light" color="gray">
                Shared
              </Badge>
            )}
          </Group>
          {mapping && (
            <Text size="sm" c="dimmed">
              → {mapping.actualAccountName ?? "Actual Budget"}
            </Text>
          )}
        </Stack>
        {mapping && (
          <ActionButton
            path="/actions/sync"
            body={{ mode: "live", account: mapping.alias }}
            refresh={refresh}
            variant="subtle"
            size="xs"
            aria-label={`Sync ${mapping.alias}`}
          >
            Sync
          </ActionButton>
        )}
      </Group>
      {mapping ? (
        <Accordion variant="contained">
          <Accordion.Item value="manage">
            <Accordion.Control>Manage Account</Accordion.Control>
            <Accordion.Panel>
              <Stack>
                <MappingForm state={state} account={account} refresh={refresh} />
                <Divider />
                <Backfill
                  alias={mapping.alias}
                  lookbackDays={state.schedule.lookbackDays}
                  refresh={refresh}
                />
                <Divider />
                <Button
                  color="red"
                  variant="light"
                  w="fit-content"
                  disabled={update?.pending}
                  onClick={() =>
                    confirm(
                      "Disconnect Account",
                      "Stop syncing this account? Existing Actual transactions will remain.",
                      "Disconnect",
                      async () => {
                        await save({
                          action: "remove-mapping",
                          revision: account.revision,
                          upAccountId: account.id,
                        });
                        refresh();
                      },
                    )
                  }
                >
                  Disconnect
                </Button>
              </Stack>
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
      ) : (
        <MappingForm state={state} account={account} refresh={refresh} />
      )}
      {update?.message && (
        <Alert color={update.failed ? "red" : update.pending ? "gray" : "green"} role="status">
          {update.message}
        </Alert>
      )}
    </Stack>
  );
}

function MappingForm({
  state,
  account,
  refresh,
}: {
  state: AppState;
  account: Account;
  refresh: () => void;
}) {
  const { mapping } = account;
  const { form, submit } = useSettingsForm(
    mappingForm,
    {
      alias: mapping?.alias ?? account.name,
      actualAccountId: mapping?.actualAccountId ?? "",
      connections: mapping?.connections ?? account.connections,
    },
    account.revision,
  );
  if (!state.actualAccounts)
    return (
      <Text size="sm" c="dimmed">
        Connect to Actual or refresh the connection to choose an account.
      </Text>
    );
  const available = state.actualAccounts.filter(
    ({ id }) => !state.accounts.some(({ mapping: other }) => other?.actualAccountId === id),
  );
  return (
    <form
      onSubmit={submit(async (values, revision) => {
        const saved = await save({
          action: "mapping",
          revision,
          upAccountId: account.id,
          ...values,
        });
        refresh();
        return saved;
      })}
    >
      <Fieldset variant="unstyled" disabled={account.update?.pending}>
        <Stack>
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <TextInput
              label="Account Name"
              maxLength={80}
              key={form.key("alias")}
              {...form.getInputProps("alias")}
            />
            {mapping ? (
              <TextInput
                label="Actual Account"
                value={mapping.actualAccountName ?? "Linked Account"}
                readOnly
              />
            ) : (
              <Select
                label="Actual Account"
                placeholder="Choose an Account"
                data={available.map(({ id, name }) => ({ value: id, label: name }))}
                key={form.key("actualAccountId")}
                {...form.getInputProps("actualAccountId")}
              />
            )}
          </SimpleGrid>
          {account.connections.length > 1 && (
            <Checkbox.Group
              label="Use Connections"
              key={form.key("connections")}
              {...form.getInputProps("connections")}
            >
              <Group mt="xs">
                {account.connections.map((id) => (
                  <Checkbox key={id} value={id} label={connectionName(id)} />
                ))}
              </Group>
            </Checkbox.Group>
          )}
          <Button type="submit" w="fit-content" loading={form.submitting}>
            {mapping ? "Save Changes" : "Connect Account"}
          </Button>
          {!mapping && state.schedule.enabled && (
            <Text size="sm" c="dimmed">
              Connecting imports full history automatically. Saving account edits does not start
              another backfill.
            </Text>
          )}
        </Stack>
      </Fieldset>
    </form>
  );
}

function Backfill({
  alias,
  lookbackDays,
  refresh,
}: {
  alias: string;
  lookbackDays: number;
  refresh: () => void;
}) {
  const [since, setSince] = useState(HISTORY_START);
  const [today] = useState(() => new Date().toISOString().slice(0, 10));
  const [pending, setPending] = useState<string>();
  const queue = async (mode: "dry-run" | "live") => {
    setPending(mode);
    await run("/actions/sync", { mode, account: alias, since });
    setPending(undefined);
    refresh();
  };
  return (
    <Stack gap="xs">
      <Group align="flex-end">
        <TextInput
          label="From Date"
          type="date"
          value={since}
          max={today}
          onChange={(event) => setSince(event.currentTarget.value)}
        />
        <Button variant="default" loading={pending === "dry-run"} onClick={() => queue("dry-run")}>
          Preview
        </Button>
        <Button loading={pending === "live"} onClick={() => queue("live")}>
          Backfill
        </Button>
      </Group>
      <Text size="sm" c="dimmed">
        Preview or import from this date. Regular Sync checks the last {lookbackDays} days.
      </Text>
    </Stack>
  );
}
