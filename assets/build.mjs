import { build } from "esbuild";
import { readFile, writeFile } from "node:fs/promises";

const result = await build({
  bundle: true,
  entryPoints: ["assets/components.js", "assets/style.css", "assets/theme.js"],
  format: "esm",
  legalComments: "inline",
  metafile: true,
  minify: true,
  outdir: "dist",
  target: ["es2022"],
});
const packages = [
  ...new Set(
    Object.keys(result.metafile.inputs)
      .filter((path) => path.startsWith("node_modules/"))
      .map((path) =>
        path
          .split("/")
          .slice(0, path.startsWith("node_modules/@") ? 3 : 2)
          .join("/"),
      ),
  ),
].sort();
const licences = [];
for (const path of packages) {
  const metadata = JSON.parse(await readFile(`${path}/package.json`, "utf8"));
  let licence;
  for (const file of ["LICENSE", "LICENSE.md", "LICENSE.txt", "license", "license.md"]) {
    try {
      licence = await readFile(`${path}/${file}`, "utf8");
      break;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  if (!licence) throw new Error(`Missing licence for ${metadata.name}`);
  licences.push(`${metadata.name} ${metadata.version}\n\n${licence}`);
}
await writeFile("dist/third-party-licences.txt", licences.join("\n\n"));
