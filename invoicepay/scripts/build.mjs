import { build } from "esbuild";

// Solana's libraries call require(); this banner makes that work inside an ES-module bundle.
const banner = "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);";

await build({
  entryPoints: ["src/plugin.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  minify: true,
  banner: { js: banner },
  outfile: "dist/plugin.mjs",
});
