import solidTransform from "../node_modules/@opentui/solid/scripts/solid-plugin.js"

const result = await Bun.build({
  entrypoints: ["src/tui.tsx"],
  outdir: "dist",
  target: "bun",
  format: "esm",
  bundle: false,
  external: ["@opencode-ai/plugin/*", "@opentui/*", "solid-js", "solid-js/*"],
  plugins: [solidTransform],
})

if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}
