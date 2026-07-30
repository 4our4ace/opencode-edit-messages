# opencode-edit-messages

A native OpenCode TUI plugin for editing the persisted **final responses** and
**reasoning** parts of assistant messages in the current session.

## Install

Install the package into the TUI plugin configuration:

```bash
opencode plugin opencode-edit-messages
```

Or add it manually to `.opencode/tui.json` (or your global `tui.json`):

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["opencode-edit-messages"]
}
```

For local development, point `plugin` at this repository's compiled module:

```json
{
  "plugin": ["file:///absolute/path/to/opencode-edit-messages/dist/tui.js"]
}
```

Run `bun install && bun run build` first. Restart OpenCode after changing
`tui.json` or the plugin configuration.

## Use

Open a session, then use either:

- `Ctrl+X`, then `E` (the normal OpenCode leader chord)
- the command palette: **Edit AI messages**
- slash command: `/edit-messages`

The full-screen editor has two columns:

- **Assistant messages** — use `Up` / `Down` to choose an AI message.
- **Editable content** — press `Right`, use `Up` / `Down` to choose a final
  response or reasoning part, then press `Enter` to edit it.

Use `Left` and `Right` to switch columns and `Esc` to return to the session.

## Important behavior

This plugin changes the stored transcript part in place through OpenCode's
experimental part-update API. It does **not** regenerate a response, rerun
tools, undo file changes, or change the context that was already used by
later messages. Treat edits to historical replies and reasoning as transcript
corrections.

## Development

```bash
bun install
bun run typecheck
bun test
bun run build
```
