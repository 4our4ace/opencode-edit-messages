/** @jsxImportSource @opentui/solid */
import { createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { useBindings } from "@opentui/keymap/solid"
import type { TextareaRenderable } from "@opentui/core"
import type { Message, Part } from "@opencode-ai/sdk/v2"
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { assistantMessages, editableParts, finalResponseParts, partLabel, preview, type EditablePart } from "./utils.js"

const routeName = "opencode-edit-messages"
const command = {
  open: "opencode-edit-messages.open",
  close: "opencode-edit-messages.close",
  previous: "opencode-edit-messages.previous",
  next: "opencode-edit-messages.next",
  focusLeft: "opencode-edit-messages.focus-left",
  focusRight: "opencode-edit-messages.focus-right",
  save: "opencode-edit-messages.save",
}

type RouteParams = { sessionID?: string }

const currentSessionID = (api: TuiPluginApi) =>
  api.route.current.name === "session" ? api.route.current.params?.sessionID : undefined

function InlineEditor(props: {
  api: TuiPluginApi
  sessionID: string
  parts: () => EditablePart[]
  onReady: (textarea: TextareaRenderable | undefined) => void
}) {
  const [draft, setDraft] = createSignal<Record<string, string>>({})
  const [saving, setSaving] = createSignal(false)
  const areas = new Map<string, TextareaRenderable>()

  createEffect(() => {
    const parts = props.parts()
    setDraft(Object.fromEntries(parts.map((part) => [part.id, part.text])))
    setTimeout(() => {
      for (const part of parts) areas.get(part.id)?.setText(part.text)
    }, 0)
  })

  const save = async () => {
    if (saving()) return
    setSaving(true)
    try {
      const changed = props.parts().filter((part) => draft()[part.id] !== part.text)
      for (const part of changed) {
        const result = await props.api.client.part.update({
          sessionID: props.sessionID,
          messageID: part.messageID,
          partID: part.id,
          part: { ...part, text: draft()[part.id] ?? "" } as Part,
        })
        if (result.error) throw result.error
      }
      props.api.ui.toast({ variant: "success", title: "Response updated", message: changed.length ? `Updated ${changed.length} transcript part${changed.length === 1 ? "" : "s"}.` : "No changes to save." })
    } catch (error) {
      props.api.ui.toast({
        variant: "error",
        title: "Could not update message",
        message: error instanceof Error ? error.message : "The server rejected the update.",
      })
    } finally {
      setSaving(false)
    }
  }

  useBindings(() => ({
    enabled: () => !saving(),
    priority: 1,
    commands: [{ name: command.save, run: () => void save() }],
    bindings: [{ key: "ctrl+s", cmd: command.save, desc: "Save response" }],
  }))

  return (
    <box flexDirection="column" gap={1} paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1}>
      {(["text", "reasoning"] as const).map((type) => {
        const parts = props.parts().filter((part) => part.type === type)
        if (!parts.length) return null
        return (
          <box flexDirection="column" gap={1}>
            <text fg={props.api.theme.current.primary}><b>{type === "text" ? "Final response" : "Reasoning"}</b></text>
            {parts.map((part, index) => (
              <box flexDirection="column" gap={1}>
                {parts.length > 1 ? <text fg={props.api.theme.current.textMuted}>{partLabel(part, index, parts.length)}</text> : null}
                <textarea
                  ref={(value) => {
                    areas.set(part.id, value)
                    if (part.id === props.parts()[0]?.id) props.onReady(value)
                  }}
                  initialValue={part.text}
                  width="100%"
                  minHeight={type === "text" ? 8 : 5}
                  maxHeight={type === "text" ? 16 : 10}
                  wrapMode="word"
                  textColor={props.api.theme.current.text}
                  focusedTextColor={props.api.theme.current.text}
                  backgroundColor={props.api.theme.current.backgroundElement}
                  focusedBackgroundColor={props.api.theme.current.backgroundElement}
                  cursorColor={props.api.theme.current.primary}
                  onContentChange={() => setDraft((current) => ({ ...current, [part.id]: areas.get(part.id)?.plainText ?? "" }))}
                />
              </box>
            ))}
          </box>
        )
      })}
      <text fg={props.api.theme.current.textMuted}>{saving() ? "Saving…" : "Ctrl+S saves changes · Enter inserts a newline"}</text>
    </box>
  )
}

function EditorRoute(props: { api: TuiPluginApi; params?: Record<string, unknown> }) {
  const dimensions = useTerminalDimensions()
  const sessionID = typeof props.params?.sessionID === "string" ? props.params.sessionID : ""
  const [revision, setRevision] = createSignal(0)
  const [messageIndex, setMessageIndex] = createSignal(0)
  const [column, setColumn] = createSignal<"messages" | "editor">("messages")
  let editor: TextareaRenderable | undefined

  const refresh = () => setRevision((value) => value + 1)
  const unsubs = [
    props.api.event.on("message.updated", (event) => event.properties.sessionID === sessionID && refresh()),
    props.api.event.on("message.removed", (event) => event.properties.sessionID === sessionID && refresh()),
    props.api.event.on("message.part.updated", (event) => event.properties.sessionID === sessionID && refresh()),
    props.api.event.on("message.part.removed", (event) => event.properties.sessionID === sessionID && refresh()),
  ]
  onCleanup(() => unsubs.forEach((unsubscribe) => unsubscribe()))

  const messageParts = (message: Message) => editableParts(props.api.state.part(message.id) as readonly Part[])
  const finalParts = (message: Message) => finalResponseParts(props.api.state.part(message.id) as readonly Part[])
  const messages = createMemo(() => {
    revision()
    return assistantMessages(props.api.state.session.messages(sessionID) as readonly Message[]).filter((message) => finalParts(message).length > 0)
  })
  const selectedMessage = createMemo(() => messages()[Math.min(messageIndex(), Math.max(0, messages().length - 1))])
  const parts = createMemo(() => {
    revision()
    const message = selectedMessage()
    return message
      ? messageParts(message).filter(
          (part) => part.type === "reasoning" || (part.type === "text" && part.ignored !== true && part.synthetic !== true),
        )
      : []
  })
  const messagePreview = (message: Message) => {
    const text = finalParts(message)
      .map((part) => part.text)
      .join(" ")
    return preview(text, 26)
  }
  const moveMessage = (amount: number) => {
    const count = messages().length
    if (!count) return
    setMessageIndex((index) => Math.max(0, Math.min(count - 1, index + amount)))
  }
  const focusEditor = () => {
    if (!parts().length) return
    setColumn("editor")
    setTimeout(() => editor?.focus(), 0)
  }
  const focusMessages = () => {
    editor?.blur()
    setColumn("messages")
  }

  useBindings(() => ({
    enabled: () => props.api.route.current.name === routeName && column() === "messages",
    priority: 1,
    commands: [
      { name: command.close, run: () => props.api.route.navigate("session", { sessionID }) },
      { name: command.previous, run: () => moveMessage(-1) },
      { name: command.next, run: () => moveMessage(1) },
      { name: command.focusRight, run: focusEditor },
    ],
    bindings: [
      { key: "escape", cmd: command.close, desc: "Return to session" },
      { key: "up", cmd: command.previous, desc: "Previous response" },
      { key: "k", cmd: command.previous, desc: "Previous response" },
      { key: "down", cmd: command.next, desc: "Next response" },
      { key: "j", cmd: command.next, desc: "Next response" },
      { key: "right", cmd: command.focusRight, desc: "Focus editor" },
      { key: "return", cmd: command.focusRight, desc: "Focus editor" },
    ],
  }))

  useBindings(() => ({
    enabled: () => props.api.route.current.name === routeName && column() === "editor",
    priority: 1,
    commands: [{ name: command.focusLeft, run: focusMessages }],
    bindings: [{ key: "left", cmd: command.focusLeft, desc: "Focus messages" }],
  }))

  const skin = props.api.theme.current
  return (
    <box width={dimensions().width} height={dimensions().height} backgroundColor={skin.background} flexDirection="column" paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between" paddingBottom={1}>
        <text fg={skin.text}><b>Edit AI messages</b></text>
        <text fg={skin.textMuted}>Esc return · ↑/↓ select · ←/→ switch columns · Ctrl+S save</text>
      </box>
      <text fg={skin.warning} paddingBottom={1}>Warning: edits change the persisted transcript only. They do not regenerate or alter subsequent model context.</text>
      <box flexDirection="row" flexGrow={1} gap={1}>
        <box width={Math.min(30, Math.max(22, Math.floor(dimensions().width * 0.26)))} flexDirection="column" border borderColor={column() === "messages" ? skin.borderActive : skin.border} paddingLeft={1} paddingRight={1}>
          <text fg={skin.primary} paddingBottom={1}>Final responses ({messages().length})</text>
           {messages().length ? messages().map((message, index) => <box backgroundColor={index === messageIndex() ? skin.primary : undefined}><text fg={index === messageIndex() ? skin.selectedListItemText : skin.textMuted}> {index === messageIndex() ? "›" : " "} {messagePreview(message)}</text></box>) : <text fg={skin.textMuted}>No assistant messages in this session.</text>}
        </box>
        <box flexGrow={1} flexDirection="column" border borderColor={column() === "editor" ? skin.borderActive : skin.border} paddingLeft={2} paddingRight={2}>
          <text fg={skin.primary} paddingBottom={1}>Response editor</text>
          <text fg={skin.warning} paddingBottom={1}>Transcript edits do not regenerate or change later model context.</text>
          {selectedMessage() ? <InlineEditor api={props.api} sessionID={sessionID} parts={parts} onReady={(textarea) => (editor = textarea)} /> : <text fg={skin.textMuted}>Select a final response to edit it and its reasoning.</text>}
        </box>
      </box>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  const open = () => {
    const sessionID = currentSessionID(api)
    if (!sessionID) {
      api.ui.toast({ variant: "warning", title: "Edit AI messages", message: "Open a session before editing its messages." })
      return
    }
    api.route.navigate(routeName, { sessionID })
  }
  api.keymap.registerLayer({
    mode: "base",
    commands: [
      {
        name: command.open,
        title: "Edit AI messages",
        category: "Plugin",
        namespace: "palette",
        slashName: "edit-messages",
        slashAliases: ["editor"],
        run: open,
      },
    ],
    bindings: [{ key: "<leader>e", cmd: command.open, desc: "Edit AI messages" }],
  })
  api.route.register([{ name: routeName, render: ({ params }) => <EditorRoute api={api} params={params} /> }])
}

export default { id: routeName, tui } satisfies TuiPluginModule
