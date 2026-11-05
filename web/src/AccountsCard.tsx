import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Group,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
} from "@mantine/core";
import type { AppState } from "../../src/api.js";
import { mappingsForm } from "../../src/schemas.js";
import { ActionButton } from "./ActionButton";
import { run } from "./api";
import { connectionName } from "./format";
import { SectionHeader } from "./SectionHeader";
import { useSettingsForm } from "./useSettingsForm";

/** Every Up account in one list; choosing an Actual account connects it. */
export function AccountsCard({ state, refresh }: { state: AppState; refresh: () => void }) {
  const { form, submit } = useSettingsForm(
    mappingsForm,
    {
      mappings: state.accounts.map(({ id, name, connections, mapping }) => ({
        upAccountId: id,
        actualAccountId: mapping?.actualAccountId ?? null,
        alias: mapping?.alias ?? name,
        connections: mapping?.connections ?? connections,
      })),
    },
    state.revisions.mappings,
  );
  const destinations = (state.actualAccounts ?? []).map(({ id, name }) => ({
    value: id,
    label: name,
  }));
  const { unavailable } = state;
  return (
    <Card>
      <Stack>
        <SectionHeader
          title="Accounts"
          description="Choose where each Up account syncs. Connecting an account imports its full history."
        >
          <ActionButton path="/actions/discover" refresh={refresh} variant="default" size="xs">
            Refresh Accounts
          </ActionButton>
        </SectionHeader>
        {unavailable.actual && (
          <Alert color="amber">Actual could not be read. Check Settings, then refresh.</Alert>
        )}
        {unavailable.connections.length > 0 && (
          <Alert color="amber">
            Could not read Up with {unavailable.connections.map(connectionName).join(", ")}. Replace
            the key in Settings or refresh.
          </Alert>
        )}
        {state.accounts.length ? (
          <form
            onSubmit={submit(async (values, revision) => {
              const saved = await run("/mappings", { ...values, revision });
              refresh();
              return saved;
            })}
          >
            <Stack>
              <Table.ScrollContainer minWidth={640}>
                <Table verticalSpacing="sm">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Up Account</Table.Th>
                      <Table.Th>Actual Account</Table.Th>
                      <Table.Th>Name</Table.Th>
                      <Table.Th>Keys</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {form.getValues().mappings.map(({ upAccountId }, index) => {
                      // Rows follow the form, so a refresh during an edit cannot shift them.
                      const account = state.accounts.find(({ id }) => id === upAccountId) ?? {
                        id: upAccountId,
                        name: "Unavailable Account",
                        connections: [],
                      };
                      return (
                        <Table.Tr key={account.id}>
                          <Table.Td>
                            <Group gap="xs">
                              <Text>{account.name}</Text>
                              {account.connections.length > 1 && (
                                <Badge variant="light" color="gray">
                                  Shared
                                </Badge>
                              )}
                            </Group>
                          </Table.Td>
                          <Table.Td>
                            <Select
                              aria-label={`Actual account for ${account.name}`}
                              placeholder="Not Synced"
                              clearable
                              data={
                                account.mapping &&
                                !destinations.some(
                                  ({ value }) => value === account.mapping?.actualAccountId,
                                )
                                  ? [
                                      ...destinations,
                                      {
                                        value: account.mapping.actualAccountId,
                                        label: "Linked Account",
                                      },
                                    ]
                                  : destinations
                              }
                              key={form.key(`mappings.${index}.actualAccountId`)}
                              {...form.getInputProps(`mappings.${index}.actualAccountId`)}
                            />
                          </Table.Td>
                          <Table.Td>
                            <TextInput
                              aria-label={`Name for ${account.name}`}
                              maxLength={80}
                              key={form.key(`mappings.${index}.alias`)}
                              {...form.getInputProps(`mappings.${index}.alias`)}
                            />
                          </Table.Td>
                          <Table.Td>
                            {account.connections.length > 1 ? (
                              <Checkbox.Group
                                key={form.key(`mappings.${index}.connections`)}
                                {...form.getInputProps(`mappings.${index}.connections`)}
                              >
                                <Group gap="xs">
                                  {account.connections.map((id) => (
                                    <Checkbox key={id} value={id} label={connectionName(id)} />
                                  ))}
                                </Group>
                              </Checkbox.Group>
                            ) : (
                              <Text size="sm">
                                {account.connections.map(connectionName).join(", ")}
                              </Text>
                            )}
                          </Table.Td>
                        </Table.Tr>
                      );
                    })}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
              <Group justify="space-between">
                <Text size="sm" c="dimmed">
                  Clearing an Actual account stops syncing it; its transactions stay in Actual.
                </Text>
                <Button type="submit" loading={form.submitting}>
                  Save Accounts
                </Button>
              </Group>
            </Stack>
          </form>
        ) : (
          <Text size="sm" c="dimmed">
            {state.connections.length
              ? "Accounts appear here once discovery finishes."
              : "Add an Up API key in Settings to list your accounts."}
          </Text>
        )}
      </Stack>
    </Card>
  );
}
