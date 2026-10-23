import { mkdir, readFile, writeFile } from "node:fs/promises";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

/** Collect the licence of every package bundled into the browser app. */
function licences(): Plugin {
  return {
    name: "third-party-licences",
    apply: "build",
    async generateBundle(_options, bundle) {
      const packages = new Set<string>();
      for (const output of Object.values(bundle))
        if (output.type === "chunk")
          for (const id of output.moduleIds) {
            const match = /node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(id);
            if (match) packages.add(match[1]!);
          }
      const entries = [
        `MantineHub shadcn theme (web/src/vendor/mantinehub)\n\n${await readFile("web/src/vendor/mantinehub/LICENSE", "utf8")}`,
      ];
      for (const name of [...packages].sort()) {
        const path = `node_modules/${name}`;
        const metadata = JSON.parse(await readFile(`${path}/package.json`, "utf8"));
        let licence: string | undefined;
        for (const file of ["LICENSE", "LICENSE.md", "LICENSE.txt", "license", "license.md"]) {
          try {
            licence = await readFile(`${path}/${file}`, "utf8");
            break;
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          }
        }
        // A few packages declare their licence without shipping its text.
        if (!licence && typeof metadata.license === "string")
          licence = `${metadata.license} (declared in package.json; no licence file is published)`;
        if (!licence) throw new Error(`Missing licence for ${metadata.name}`);
        entries.push(`${metadata.name} ${metadata.version}\n\n${licence}`);
      }
      await mkdir("dist", { recursive: true });
      await writeFile("dist/third-party-licences.txt", entries.join("\n\n"));
    },
  };
}

export default defineConfig({
  root: "web",
  plugins: [react(), licences()],
  // One private app; a single bundle is simpler than code splitting.
  build: { outDir: "../dist/public", emptyOutDir: true, chunkSizeWarningLimit: 1024 },
});
