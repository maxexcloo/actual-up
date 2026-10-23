import { Container, createTheme, getSize, mergeThemeOverrides } from "@mantine/core";
import { shadcnCssVariableResolver } from "./vendor/mantinehub/themes/shadcn/shadcn-css-variable-resolver";
import { shadcnTheme } from "./vendor/mantinehub/themes/shadcn/shadcn-theme";

const font = "Geist Variable, ui-sans-serif, system-ui, sans-serif";

// The preset only generates contrast variables for palette names, so the primary colour is
// "zinc" (the palette behind its "primary" alias) and status colours use green, red and amber.
// The preset also shrinks container sizes (md is 500px), so Container keeps Mantine's own scale.
// Apart from that, the only app-specific styling is the locally bundled Geist font.
export const theme = mergeThemeOverrides(
  shadcnTheme,
  createTheme({
    primaryColor: "zinc",
    fontFamily: font,
    headings: { fontFamily: font },
    components: {
      Container: Container.extend({
        vars: (_, { size, fluid }) => ({
          root: { "--container-size": fluid ? "100%" : getSize(size, "container-size") },
        }),
      }),
    },
  }),
);
export const cssVariablesResolver = shadcnCssVariableResolver;
