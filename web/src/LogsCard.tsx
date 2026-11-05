import { Accordion, Card, Code, Text } from "@mantine/core";
import type { LogEntry } from "../../src/api.js";

const time = (value: string, timezone: string) =>
  new Intl.DateTimeFormat("en-AU", { timeStyle: "medium", timeZone: timezone }).format(
    new Date(value),
  );

/** The app's recent log lines; they never contain bank data and reset on restart. */
export function LogsCard({ logs, timezone }: { logs: LogEntry[]; timezone: string }) {
  return (
    <Card>
      <Accordion>
        <Accordion.Item value="logs">
          <Accordion.Control>Logs · {logs.length} Recent Lines</Accordion.Control>
          <Accordion.Panel>
            {logs.length ? (
              <Code block>
                {logs
                  .map((entry) =>
                    [
                      time(entry.time, timezone),
                      entry.level.toUpperCase(),
                      entry.message,
                      entry.context,
                    ]
                      .filter(Boolean)
                      .join("  "),
                  )
                  .join("\n")}
              </Code>
            ) : (
              <Text size="sm" c="dimmed">
                Nothing logged since the app started.
              </Text>
            )}
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
    </Card>
  );
}
