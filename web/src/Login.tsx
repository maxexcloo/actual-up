import {
  Alert,
  Button,
  Card,
  Center,
  PasswordInput,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { schemaResolver, useForm } from "@mantine/form";
import { useState } from "react";
import { loginForm } from "../../src/schemas.js";
import { send } from "./api";

export function Login({ onSignedIn }: { onSignedIn: () => void }) {
  const [error, setError] = useState("");
  const form = useForm({
    mode: "uncontrolled",
    initialValues: { username: "", password: "" },
    validate: schemaResolver(loginForm, { sync: true }),
  });
  return (
    <Center mih="70vh">
      <Card w="100%" maw={420}>
        <form
          onSubmit={form.onSubmit(async (values) => {
            const result = await send("/login", values);
            if (result.ok) onSignedIn();
            else setError(result.error);
          })}
        >
          <Stack>
            <Stack gap={4}>
              <Title order={2}>Sign In</Title>
              <Text c="dimmed">Your accounts, kept in sync.</Text>
            </Stack>
            {error && (
              <Alert color="red" role="alert">
                {error}
              </Alert>
            )}
            <TextInput
              label="Username"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              autoFocus
              key={form.key("username")}
              {...form.getInputProps("username")}
            />
            <PasswordInput
              label="Password"
              autoComplete="current-password"
              key={form.key("password")}
              {...form.getInputProps("password")}
            />
            <Button type="submit" loading={form.submitting}>
              Sign In
            </Button>
          </Stack>
        </form>
      </Card>
    </Center>
  );
}
