import { readFile } from "node:fs/promises";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "web",
  plugins: [
    react(),
    {
      // Vite's licence file only covers node_modules, so the vendored theme ships its own.
      name: "mantinehub-licence",
      apply: "build",
      async generateBundle() {
        this.emitFile({
          fileName: ".vite/mantinehub-license.md",
          source: await readFile("web/src/vendor/mantinehub/LICENSE", "utf8"),
          type: "asset",
        });
      },
    },
  ],
  // One private app; a single bundle is simpler than code splitting.
  build: {
    outDir: "../dist/public",
    emptyOutDir: true,
    chunkSizeWarningLimit: 1024,
    license: true,
  },
});
