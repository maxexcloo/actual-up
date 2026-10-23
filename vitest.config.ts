import { defineConfig } from "vitest/config";

// Kept apart from vite.config.ts, whose root is the browser app.
export default defineConfig({ test: { include: ["test/**/*.test.ts"] } });
