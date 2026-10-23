import { Group, Stack, Text, Title } from "@mantine/core";
import type { ReactNode } from "react";

/** The title row every card and the page share: heading and description, then actions. */
export function SectionHeader({
  title,
  description,
  order = 3,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  order?: 1 | 2 | 3 | 4;
  children?: ReactNode;
}) {
  return (
    <Group justify="space-between" align="flex-start" gap="sm">
      <Stack gap={2}>
        <Title order={order}>{title}</Title>
        {description && (
          <Text size="sm" c="dimmed">
            {description}
          </Text>
        )}
      </Stack>
      {children && <Group gap="xs">{children}</Group>}
    </Group>
  );
}
