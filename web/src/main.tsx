import "@fontsource-variable/geist";
import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import "./vendor/mantinehub/shadcn-styles.css";
import { MantineProvider } from "@mantine/core";
import { ModalsProvider } from "@mantine/modals";
import { Notifications } from "@mantine/notifications";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { cssVariablesResolver, theme } from "./theme";

// The server's Content-Security-Policy only admits Mantine's style element with this nonce.
const nonce = document.querySelector<HTMLMetaElement>('meta[name="style-nonce"]')?.content ?? "";
// Mantine's scroll lock (react-style-singleton via get-nonce) reads the nonce from this global.
(globalThis as { __webpack_nonce__?: string }).__webpack_nonce__ = nonce;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MantineProvider
      theme={theme}
      cssVariablesResolver={cssVariablesResolver}
      defaultColorScheme="auto"
      getStyleNonce={() => nonce}
    >
      <ModalsProvider>
        <Notifications position="bottom-right" />
        <App />
      </ModalsProvider>
    </MantineProvider>
  </StrictMode>,
);
