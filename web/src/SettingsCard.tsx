import {
  ActionIcon,
  Accordion,
  Button,
  Card,
  Checkbox,
  Group,
  PasswordInput,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { IconTrash } from "@tabler/icons-react";
import type { AppState } from "../../src/api.js";
import { settingsForm } from "../../src/schemas.js";
import { ActionButton } from "./ActionButton";
import { run } from "./api";
import { connectionName } from "./format";
import { SectionHeader } from "./SectionHeader";
import { useSettingsForm } from "./useSettingsForm";

/** Actual and every Up key in one form; saving checks whatever changed. */
export function SettingsCard({ state, refresh }: { state: AppState; refresh: () => void }) {
  const { actual } = state;
  const { form, submit } = useSettingsForm(
    settingsForm,
    {
      actual: {
        serverUrl: actual.serverUrl,
        syncId: actual.syncId,
        method: actual.method,
        credential: "",
        encryptionPassword: "",
        clearEncryption: false,
      },
      connections: state.connections.map((id) => ({ id, token: "" })),
    },
    state.revisions.settings,
    (values) => ({
      "actual.credential":
        actual.configured || values.actual.credential
          ? undefined
          : "Enter the Actual session token or password",
      ...Object.fromEntries(
        values.connections.map(({ id, token }, index) => [
          `connections.${index}.token`,
          token || state.connections.includes(id) ? undefined : "Enter an Up API key",
        ]),
      ),
    }),
  );
  return (
    <Card>
      <Accordion defaultValue={actual.configured ? null : "settings"}>
        <Accordion.Item value="settings">
          <Accordion.Control>
            <SectionHeader
              title="Settings"
              description={
                actual.configured
                  ? `Actual Budget · ${state.connections.map(connectionName).join(", ") || "No Up keys"}`
                  : "Connect Actual Budget and add your Up API keys to start."
              }
            />
          </Accordion.Control>
          <Accordion.Panel>
            <form
              onSubmit={submit(async (values, revision) => {
                const saved = await run("/settings", { ...values, revision });
                refresh();
                return saved;
              })}
            >
              <Stack>
                <SimpleGrid cols={{ base: 1, sm: 2 }}>
                  <TextInput
                    label="Actual Server URL"
                    type="url"
                    key={form.key("actual.serverUrl")}
                    {...form.getInputProps("actual.serverUrl")}
                  />
                  <TextInput
                    label="Budget Sync ID"
                    key={form.key("actual.syncId")}
                    {...form.getInputProps("actual.syncId")}
                  />
                  <Select
                    label="Authentication"
                    allowDeselect={false}
                    data={[
                      { value: "session", label: "Session Token" },
                      { value: "password", label: "Password" },
                    ]}
                    key={form.key("actual.method")}
                    {...form.getInputProps("actual.method")}
                  />
                  <PasswordInput
                    label="Session Token or Password"
                    autoComplete="new-password"
                    placeholder={actual.configured ? "Leave blank to keep" : undefined}
                    key={form.key("actual.credential")}
                    {...form.getInputProps("actual.credential")}
                  />
                  <PasswordInput
                    label="Budget Encryption Password"
                    description="Optional"
                    autoComplete="new-password"
                    placeholder={actual.encryptionPassword ? "Leave blank to keep" : undefined}
                    key={form.key("actual.encryptionPassword")}
                    {...form.getInputProps("actual.encryptionPassword")}
                  />
                  {actual.encryptionPassword && (
                    <Checkbox
                      mt="xl"
                      label="Remove Saved Encryption Password"
                      key={form.key("actual.clearEncryption")}
                      {...form.getInputProps("actual.clearEncryption", { type: "checkbox" })}
                    />
                  )}
                </SimpleGrid>
                <Text fw={600}>Up API Keys</Text>
                {form.getValues().connections.map(({ id }, index) => {
                  const saved = state.connections.includes(id);
                  return (
                    <Group key={form.key(`connections.${index}`)} align="flex-end" wrap="nowrap">
                      <TextInput
                        label="Name"
                        placeholder="e.g. max"
                        maxLength={80}
                        readOnly={saved}
                        key={form.key(`connections.${index}.id`)}
                        {...form.getInputProps(`connections.${index}.id`)}
                      />
                      <PasswordInput
                        flex={1}
                        label={saved ? "Replace Key" : "API Key"}
                        placeholder={saved ? "Leave blank to keep" : undefined}
                        autoComplete="new-password"
                        maxLength={8192}
                        key={form.key(`connections.${index}.token`)}
                        {...form.getInputProps(`connections.${index}.token`)}
                      />
                      <ActionIcon
                        variant="subtle"
                        color="red"
                        size="lg"
                        mb={2}
                        aria-label={`Remove ${id || "key"}`}
                        onClick={() => form.removeListItem("connections", index)}
                      >
                        <IconTrash size={18} />
                      </ActionIcon>
                    </Group>
                  );
                })}
                <Text size="sm" c="dimmed">
                  Use a short lowercase name for each key. Keys are encrypted and never shown again.
                </Text>
                <Group justify="space-between">
                  <Group gap="xs">
                    <Button
                      variant="default"
                      onClick={() => form.insertListItem("connections", { id: "", token: "" })}
                    >
                      Add Key
                    </Button>
                    {actual.configured && (
                      <ActionButton path="/actions/validate" refresh={refresh} variant="default">
                        Check Connections
                      </ActionButton>
                    )}
                  </Group>
                  <Button type="submit" loading={form.submitting}>
                    Test &amp; Save
                  </Button>
                </Group>
              </Stack>
            </form>
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
    </Card>
  );
}
