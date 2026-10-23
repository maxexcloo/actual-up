import { Button, type ButtonProps } from "@mantine/core";
import { useState, type ReactNode } from "react";
import { run } from "./api";

/** A button that queues one server action and reports the outcome. */
export function ActionButton({
  path,
  body,
  refresh,
  children,
  ...props
}: ButtonProps & { path: string; body?: object; refresh: () => void; children: ReactNode }) {
  const [loading, setLoading] = useState(false);
  return (
    <Button
      {...props}
      loading={loading}
      onClick={async () => {
        setLoading(true);
        await run(path, body);
        setLoading(false);
        refresh();
      }}
    >
      {children}
    </Button>
  );
}
