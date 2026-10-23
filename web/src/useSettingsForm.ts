import { schemaResolver, useForm } from "@mantine/form";
import { useEffect, useState } from "react";
import type { z } from "zod";

type Errors = Record<string, string | undefined>;

/**
 * A form for saved settings. While untouched it follows the server's values and
 * revision; once edited it keeps the revision it started from, so the server rejects
 * a save that would overwrite a change made elsewhere.
 */
export function useSettingsForm<Values extends Record<string, unknown>>(
  schema: z.ZodType,
  values: Values,
  revision: string,
  validate?: (values: Values) => Errors,
) {
  const resolver = schemaResolver(schema, { sync: true });
  const form = useForm<Values>({
    mode: "uncontrolled",
    initialValues: values,
    validate: (current) =>
      Object.fromEntries(
        Object.entries({ ...resolver(current), ...validate?.(current) }).filter(
          ([, error]) => error,
        ),
      ),
  });
  const [base, setBase] = useState(revision);
  const snapshot = JSON.stringify(values);
  useEffect(() => {
    if (form.isDirty()) return;
    form.setInitialValues(values);
    form.reset();
    setBase(revision);
    // The snapshot stands in for the values object, which changes identity every render.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [revision, snapshot]);
  return {
    form,
    /** Submit with the revision the edit started from; clean up after the server accepts it. */
    submit: (handler: (values: Values, revision: string) => Promise<boolean>) =>
      form.onSubmit(async (current) => {
        if (await handler(current, base)) form.resetDirty();
      }),
  };
}
