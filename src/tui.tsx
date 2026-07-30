/** @jsxImportSource @opentui/solid */
import { createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { useBindings } from "@opentui/keymap/solid"
import type { TextareaRenderable } from "@opentui/core"
import type { Message, Part } from "@opencode-ai/sdk/v2"
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { assistantMessages, editableParts, finalResponseParts, preview, type EditablePart } from "./utils.js"

const routeName = "opencode-edit-messages"
const command = {
  open: "opencode-edit-messages.open",
  close: "opencode-edit-messages.close",
  previous: "opencode-edit-messages.previous",
  next: "opencode-edit-messages.next",
  focusLeft: "opencode-edit-messages.focus-left",
  focusRight: "opencode-edit-messages.focus-right",
  save: "opencode-edit-messages.save",
  edit: "opencode-edit-messages.edit",
  restore: "opencode-edit-messages.restore",
}

type RouteParams = { sessionID?: string }
type Column = "messages" | "editor"

const currentSessionID = (api: TuiPluginApi) =>
  api.route.current.name === "session" ? api.route.current.params?.sessionID : undefined

function EditorRoute(props: { api: TuiPluginApi; params?: Record<string, unknown> }) {
  const dimensions = useTerminalDimensions()
  const sessionID = typeof props.params?.sessionID === "string" ? props.params.sessionID : ""
  const [revision, setRevision] = createSignal(0)
  const [messageIndex, setMessageIndex] = createSignal(0)
  const [partIndex, setPartIndex] = createSignal(0)
  const [column, setColumn] = createSignal<Column>("messages")
  const [editing, setEditing] = createSignal(false)
  const [draft, setDraft] = createSignal("")
  const [saving, setSaving] = createSignal(false)
  const originalText = new Map<string, string>()
  let textarea: TextareaRenderable | undefined

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
    if (!message) return []
    const editable = messageParts(message).filter(
      (part) => part.type === "reasoning" || (part.type === "text" && part.ignored !== true && part.synthetic !== true),
    )
    return [...editable.filter((part) => part.type === "text"), ...editable.filter((part) => part.type === "reasoning")]
  })
  const selectedPart = createMemo(() => parts()[Math.min(partIndex(), Math.max(0, parts().length - 1))])
  const visibleMessages = createMemo(() => {
    const all = messages()
    const selected = Math.min(messageIndex(), Math.max(0, all.length - 1))
    const start = Math.max(0, Math.min(selected - 4, Math.max(0, all.length - 9)))
    return all.slice(start, start + 9).map((message, offset) => ({ message, index: start + offset }))
  })

  createEffect(() => {
    for (const part of parts()) {
      if (!originalText.has(part.id)) originalText.set(part.id, part.text)
    }
  })

  const messagePreview = (message: Message) => preview(finalParts(message).map((part) => part.text).join(" "), 26)
  const elementLabel = (part: EditablePart, index: number) => {
    if (part.type === "reasoning") return `Reasoning ${parts().slice(0, index + 1).filter((item) => item.type === "reasoning").length}`
    const textCount = parts().filter((item) => item.type === "text").length
    const textIndex = parts().slice(0, index + 1).filter((item) => item.type === "text").length
    return textCount === 1 ? "Final response" : `Final response ${textIndex}`
  }
  const moveMessage = (amount: number) => {
    const count = messages().length
    if (!count) return
    setMessageIndex((index) => Math.max(0, Math.min(count - 1, index + amount)))
    setPartIndex(0)
  }
  const movePart = (amount: number) => {
    const count = parts().length
    if (!count) return
    setPartIndex((index) => Math.max(0, Math.min(count - 1, index + amount)))
  }
  const close = () => props.api.route.navigate("session", { sessionID })
  const focusEditor = () => {
    if (!parts().length) return
    setColumn("editor")
  }
  const focusMessages = () => setColumn("messages")
  const startEditing = () => {
    const part = selectedPart()
    if (!part || saving()) return
    setDraft(part.text)
    setEditing(true)
    setTimeout(() => {
      textarea?.setText(part.text)
      textarea?.focus()
    }, 0)
  }
  const save = async () => {
    const part = selectedPart()
    if (!part || saving()) return
    setSaving(true)
    try {
      if (draft() !== part.text) {
        const result = await props.api.client.part.update({
          sessionID,
          messageID: part.messageID,
          partID: part.id,
          part: { ...part, text: draft() } as Part,
        })
        if (result.error) throw result.error
      }
      setEditing(false)
      textarea?.blur()
      refresh()
      props.api.ui.toast({ variant: "success", title: "Response updated", message: draft() === part.text ? "No changes to save." : "Transcript part updated." })
    } catch (error) {
      props.api.ui.toast({ variant: "error", title: "Could not update message", message: error instanceof Error ? error.message : "The server rejected the update." })
    } finally {
      setSaving(false)
    }
  }
  const restore = async () => {
    const part = selectedPart()
    const text = part && originalText.get(part.id)
    if (!part || text === undefined || saving()) return
    setSaving(true)
    try {
      const result = await props.api.client.part.update({ sessionID, messageID: part.messageID, partID: part.id, part: { ...part, text } as Part })
      if (result.error) throw result.error
      refresh()
      props.api.ui.toast({ variant: "success", title: "Response restored", message: "Restored the text first loaded for this element." })
    } catch (error) {
      props.api.ui.toast({ variant: "error", title: "Could not restore message", message: error instanceof Error ? error.message : "The server rejected the update." })
    } finally {
      setSaving(false)
    }
  }

  useBindings(() => ({
    enabled: () => props.api.route.current.name === routeName,
    priority: 100,
    commands: [{ name: command.close, run: close }],
    bindings: [{ key: "ctrl+c", cmd: command.close, desc: "Exit editor" }],
  }))
  useBindings(() => ({
    enabled: () => props.api.route.current.name === routeName && !editing() && column() === "messages",
    priority: 100,
    commands: [
      { name: command.close, run: close }, { name: command.previous, run: () => moveMessage(-1) }, { name: command.next, run: () => moveMessage(1) },
      { name: command.focusRight, run: focusEditor },
    ],
    bindings: [
      { key: "escape", cmd: command.close, desc: "Return to session" }, { key: "up", cmd: command.previous, desc: "Previous response" }, { key: "k", cmd: command.previous, desc: "Previous response" },
      { key: "down", cmd: command.next, desc: "Next response" }, { key: "j", cmd: command.next, desc: "Next response" },
      { key: "right", cmd: command.focusRight, desc: "Focus elements" }, { key: "return", cmd: command.focusRight, desc: "Focus elements" },
    ],
  }))
  useBindings(() => ({
    enabled: () => props.api.route.current.name === routeName && !editing() && column() === "editor",
    priority: 100,
    commands: [
      { name: command.close, run: close }, { name: command.previous, run: () => movePart(-1) }, { name: command.next, run: () => movePart(1) },
      { name: command.focusLeft, run: focusMessages }, { name: command.edit, run: startEditing }, { name: command.restore, run: () => void restore() },
    ],
    bindings: [
      { key: "escape", cmd: command.close, desc: "Return to session" }, { key: "up", cmd: command.previous, desc: "Previous element" }, { key: "k", cmd: command.previous, desc: "Previous element" },
      { key: "down", cmd: command.next, desc: "Next element" }, { key: "j", cmd: command.next, desc: "Next element" }, { key: "left", cmd: command.focusLeft, desc: "Focus responses" },
      { key: "return", cmd: command.edit, desc: "Edit element" }, { key: "r", cmd: command.restore, desc: "Restore original" },
    ],
  }))
  useBindings(() => ({
    enabled: () => props.api.route.current.name === routeName && editing() && !saving(),
    priority: 100,
    commands: [{ name: command.save, run: () => void save() }],
    bindings: [{ key: "ctrl+s", cmd: command.save, desc: "Save element" }, { key: "escape", cmd: command.save, desc: "Save element" }],
  }))

  const skin = props.api.theme.current
  return (
    <box width={dimensions().width} height={dimensions().height} backgroundColor={skin.background} flexDirection="column" paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between" paddingBottom={1}>
        <text fg={skin.text}><b>Edit AI messages</b></text>
        <text fg={skin.textMuted}>{editing() ? "Ctrl+S/Esc save · Enter newline · Ctrl+C exit" : "↑/↓ select · ←/→ switch · Enter edit · R restore · Esc exit · Ctrl+C exit"}</text>
      </box>
      <text fg={skin.warning} paddingBottom={1}>Warning: edits change the persisted transcript only. They do not regenerate or alter subsequent model context.</text>
      <box flexDirection="row" flexGrow={1} gap={1}>
        <box width={Math.min(30, Math.max(22, Math.floor(dimensions().width * 0.26)))} flexDirection="column" border borderColor={column() === "messages" ? skin.borderActive : skin.border} paddingLeft={1} paddingRight={1}>
          <text fg={skin.primary} paddingBottom={1}>Final responses ({messages().length})</text>
          {messages().length ? visibleMessages().map(({ message, index }) => <box backgroundColor={index === messageIndex() ? skin.primary : undefined}><text fg={index === messageIndex() ? skin.selectedListItemText : skin.textMuted}> {index === messageIndex() ? "›" : " "} {index + 1}. {messagePreview(message)}</text></box>) : <text fg={skin.textMuted}>No assistant messages in this session.</text>}
        </box>
        <box flexGrow={1} flexDirection="column" border borderColor={column() === "editor" ? skin.borderActive : skin.border} paddingLeft={2} paddingRight={2}>
          <text fg={skin.primary} paddingBottom={1}>Response elements</text>
          {selectedMessage() ? <>
            <box flexDirection="column" paddingBottom={1}>{parts().map((part, index) => <box backgroundColor={index === partIndex() ? skin.primary : undefined}><text fg={index === partIndex() ? skin.selectedListItemText : skin.textMuted}> {index === partIndex() ? "›" : " "} {elementLabel(part, index)}</text></box>)}</box>
            <text fg={skin.textMuted} paddingBottom={1}>{editing() ? "Editing selected element" : "Preview (press Enter to edit)"}</text>
            {editing() && selectedPart() ? <textarea ref={(value) => (textarea = value)} initialValue={draft()} width="100%" flexGrow={1} minHeight={8} wrapMode="word" textColor={skin.text} focusedTextColor={skin.text} backgroundColor={skin.backgroundElement} focusedBackgroundColor={skin.backgroundElement} cursorColor={skin.primary} onContentChange={() => setDraft(textarea?.plainText ?? "")} /> : <box flexGrow={1} minHeight={8} backgroundColor={skin.backgroundElement} paddingLeft={1} paddingRight={1} paddingTop={1}><text fg={skin.text}>{selectedPart()?.text || "(empty)"}</text></box>}
          </> : <text fg={skin.textMuted}>Select a final response to edit it and its reasoning.</text>}
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
  api.keymap.registerLayer({ mode: "base", commands: [{ name: command.open, title: "Edit AI messages", category: "Plugin", namespace: "palette", slashName: "edit-messages", slashAliases: ["editor"], run: open }], bindings: [{ key: "<leader>e", cmd: command.open, desc: "Edit AI messages" }] })
  api.route.register([{ name: routeName, render: ({ params }) => <EditorRoute api={api} params={params} /> }])
}

export default { id: routeName, tui } satisfies TuiPluginModule
