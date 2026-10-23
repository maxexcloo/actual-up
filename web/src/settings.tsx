import { Alert, Badge, Text } from "@mantine/core";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import type { ConnectionStatus, JobState } from "../../src/api.js";
import type { SettingsCommand } from "../../src/schemas.js";
import { send } from "./api";

/** Queue a settings change; progress then arrives through the polled state. */
export async function save(command: SettingsCommand): Promise<boolean> {
  const result = await send("/settings", command);
  if (!result.ok) notifications.show({ color: "red", message: result.error });
  return result.ok;
}

export function confirm(title: string, message: string, label: string, onConfirm: () => void) {
  modals.openConfirmModal({
    title,
    children: <Text size="sm">{message}</Text>,
    labels: { confirm: label, cancel: "Cancel" },
    confirmProps: { color: "red" },
    onConfirm,
  });
}

const statuses: Record<ConnectionStatus, [colour: string, label: string]> = {
  connected: ["green", "Connected"],
  attention: ["amber", "Needs Attention"],
  configured: ["gray", "Configured"],
  setup: ["gray", "Set Up Required"],
  unchecked: ["gray", "Not Checked"],
};

export function StatusBadge({ status }: { status: ConnectionStatus }) {
  const [colour, label] = statuses[status];
  return (
    <Badge variant="light" color={colour}>
      {label}
    </Badge>
  );
}

export function TestResult({ state }: { state?: JobState }) {
  if (!state) return null;
  if (state === "queued" || state === "running")
    return (
      <Alert color="gray" role="status">
        Testing Connection…
      </Alert>
    );
  if (state === "success")
    return (
      <Alert color="green" role="status">
        Connection Working
      </Alert>
    );
  return (
    <Alert color="red" role="status">
      Connection Failed · Check the saved connection details and retry Test.
    </Alert>
  );
}
