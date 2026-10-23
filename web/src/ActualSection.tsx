import {
  Accordion,
  Button,
  Card,
  Checkbox,
  Fieldset,
  Group,
  PasswordInput,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import type { AppState } from "../../src/api.js";
import { actualForm } from "../../src/schemas.js";
import { ActionButton } from "./ActionButton";
import { SectionHeader } from "./SectionHeader";
import { save, StatusBadge, TestResult } from "./settings";
import { useSettingsForm } from "./useSettingsForm";

export function ActualSection({ state, refresh }: { state: AppState; refresh: () => void }) {
  const { actual } = state;
  const { form, submit } = useSettingsForm(
    actualForm,
    {
      serverUrl: actual.serverUrl,
      syncId: actual.syncId,
      method: actual.method,
      credential: "",
      encryptionPassword: "",
      clearEncryption: false,
    },
    state.revision,
    ({ credential }) => ({
      credential:
        actual.configured || credential ? undefined : "Enter the Actual session token or password",
    }),
  );
  return (
    <Card>
      <Stack>
        <SectionHeader title="Actual Budget" description="Destination for your transactions">
          <StatusBadge status={actual.status} />
          {actual.configured && (
            <ActionButton
              path="/actions/test"
              body={{ target: "actual" }}
              refresh={refresh}
              variant="subtle"
              size="xs"
            >
              Test
            </ActionButton>
          )}
        </SectionHeader>
        <TestResult state={actual.test} />
        <Accordion variant="contained" defaultValue={actual.configured ? null : "settings"}>
          <Accordion.Item value="settings">
            <Accordion.Control>Connection Settings</Accordion.Control>
            <Accordion.Panel>
              <form
                onSubmit={submit(async (values, revision) => {
                  const saved = await save({ action: "actual", revision, ...values });
                  refresh();
                  return saved;
                })}
              >
                <Fieldset variant="unstyled" disabled={state.busy}>
                  <Stack>
                    <SimpleGrid cols={{ base: 1, sm: 2 }}>
                      <TextInput
                        label="Server URL"
                        type="url"
                        key={form.key("serverUrl")}
                        {...form.getInputProps("serverUrl")}
                      />
                      <TextInput
                        label="Budget Sync ID"
                        key={form.key("syncId")}
                        {...form.getInputProps("syncId")}
                      />
                      <Select
                        label="Authentication"
                        allowDeselect={false}
                        data={[
                          { value: "session", label: "Session Token" },
                          { value: "password", label: "Password" },
                        ]}
                        key={form.key("method")}
                        {...form.getInputProps("method")}
                      />
                      <PasswordInput
                        label="Session Token or Password"
                        autoComplete="new-password"
                        placeholder={
                          actual.configured ? "Leave blank to keep saved credential" : undefined
                        }
                        key={form.key("credential")}
                        {...form.getInputProps("credential")}
                      />
                    </SimpleGrid>
                    <PasswordInput
                      label="Budget Encryption Password"
                      description="Optional"
                      autoComplete="new-password"
                      placeholder="Leave blank to keep saved password"
                      key={form.key("encryptionPassword")}
                      {...form.getInputProps("encryptionPassword")}
                    />
                    {actual.encryptionPassword && (
                      <Checkbox
                        label="Remove Saved Encryption Password"
                        key={form.key("clearEncryption")}
                        {...form.getInputProps("clearEncryption", { type: "checkbox" })}
                      />
                    )}
                    <Group justify="space-between">
                      <Text size="sm" c="dimmed">
                        Tests these details before saving.
                        {actual.configured && " The Test button above checks the saved connection."}
                      </Text>
                      <Button type="submit" loading={form.submitting}>
                        Test &amp; Save Connection
                      </Button>
                    </Group>
                  </Stack>
                </Fieldset>
              </form>
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
      </Stack>
    </Card>
  );
}
