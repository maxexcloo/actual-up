import {
  ActionIcon,
  AppShell,
  Button,
  Container,
  Group,
  Title,
  useComputedColorScheme,
  useMantineColorScheme,
} from "@mantine/core";
import { IconLogout, IconMoon, IconSun } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { send } from "./api";

export function Shell({ children, onSignOut }: { children: ReactNode; onSignOut?: () => void }) {
  const { setColorScheme } = useMantineColorScheme();
  const dark = useComputedColorScheme("light") === "dark";
  return (
    <AppShell header={{ height: 60 }} padding="md">
      <AppShell.Header>
        <Container size="lg" h="100%">
          <Group h="100%" justify="space-between">
            <Title order={4}>Actual Up</Title>
            <Group gap="xs">
              <ActionIcon
                variant="subtle"
                color="gray"
                size="lg"
                aria-label={dark ? "Light Mode" : "Dark Mode"}
                title={dark ? "Switch to Light Mode" : "Switch to Dark Mode"}
                onClick={() => setColorScheme(dark ? "light" : "dark")}
              >
                {dark ? <IconSun size={18} /> : <IconMoon size={18} />}
              </ActionIcon>
              {onSignOut && (
                <Button
                  variant="subtle"
                  color="gray"
                  leftSection={<IconLogout size={16} />}
                  onClick={async () => {
                    await send("/logout");
                    onSignOut();
                  }}
                >
                  Sign Out
                </Button>
              )}
            </Group>
          </Group>
        </Container>
      </AppShell.Header>
      <AppShell.Main>
        <Container size="lg" pb="xl">
          {children}
        </Container>
      </AppShell.Main>
    </AppShell>
  );
}
