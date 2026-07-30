/** @jsxImportSource @opentui/solid */
import { createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js"
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
type ResponseElement = {
  type: "text" | "reasoning"
  label: "Final response" | "Reasoning"
  parts: EditablePart[]
}

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
  const [search, setSearch] = createSignal("")
  const [drafts, setDrafts] = createSignal<string[]>([])
  const [saving, setSaving] = createSignal(false)
  const originalText = new Map<string, string>()
  let textareas: TextareaRenderable[] = []
  let searchInput: { focus: () => void; blur: () => void; isDestroyed?: boolean } | undefined

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
  const filteredMessages = createMemo(() => {
    const query = search().trim().toLocaleLowerCase()
    if (!query) return messages()
    return messages().filter((message) => finalParts(message).some((part) => part.text.toLocaleLowerCase().includes(query)))
  })
  const selectedMessage = createMemo(() => filteredMessages()[Math.min(messageIndex(), Math.max(0, filteredMessages().length - 1))])
  const elements = createMemo<ResponseElement[]>(() => {
    revision()
    const message = selectedMessage()
    if (!message) return []
    const editable = messageParts(message).filter(
      (part) => part.type === "reasoning" || (part.type === "text" && part.ignored !== true && part.synthetic !== true),
    )
    const final = editable.filter((part) => part.type === "text")
    const reasoning = editable.filter((part) => part.type === "reasoning")
    return [
      ...(final.length ? [{ type: "text" as const, label: "Final response" as const, parts: final }] : []),
      ...(reasoning.length ? [{ type: "reasoning" as const, label: "Reasoning" as const, parts: reasoning }] : []),
    ]
  })
  const selectedElement = createMemo(() => elements()[Math.min(partIndex(), Math.max(0, elements().length - 1))])

  createEffect(() => {
    for (const element of elements()) {
      for (const part of element.parts) {
        if (!originalText.has(part.id)) originalText.set(part.id, part.text)
      }
    }
  })

  const messagePreview = (message: Message) => preview(finalParts(message).map((part) => part.text).join(" "), 26)
  const moveMessage = (amount: number) => {
    const count = filteredMessages().length
    if (!count) return
    setMessageIndex((index) => Math.max(0, Math.min(count - 1, index + amount)))
    setPartIndex(0)
  }
  const movePart = (amount: number) => {
    const count = elements().length
    if (!count) return
    setPartIndex((index) => Math.max(0, Math.min(count - 1, index + amount)))
  }
  const close = () => props.api.route.navigate("session", { sessionID })
  const focusEditor = () => {
    if (!elements().length) return
    searchInput?.blur()
    setColumn("editor")
  }
  const focusMessages = () => {
    setColumn("messages")
    setTimeout(() => {
      if (searchInput && !searchInput.isDestroyed) searchInput.focus()
    }, 0)
  }
  const startEditing = () => {
    const element = selectedElement()
    if (!element || saving()) return
    const values = element.parts.map((part) => part.text)
    textareas = []
    setDrafts(values)
    setEditing(true)
    setTimeout(() => {
      textareas[0]?.focus()
    }, 0)
  }
  const save = async () => {
    const element = selectedElement()
    if (!element || saving()) return
    const values = drafts()
    setSaving(true)
    try {
      let changed = false
      for (const [index, part] of element.parts.entries()) {
        const text = values[index] ?? part.text
        if (text === part.text) continue
        changed = true
        const result = await props.api.client.part.update({ sessionID, messageID: part.messageID, partID: part.id, part: { ...part, text } as Part })
        if (result.error) throw result.error
      }
      setEditing(false)
      textareas.forEach((textarea) => textarea.blur())
      refresh()
      props.api.ui.toast({ variant: "success", title: "Response updated", message: changed ? "Transcript parts updated." : "No changes to save." })
    } catch (error) {
      props.api.ui.toast({ variant: "error", title: "Could not update message", message: error instanceof Error ? error.message : "The server rejected the update." })
    } finally {
      setSaving(false)
    }
  }
  const restore = async () => {
    const element = selectedElement()
    if (!element || saving()) return
    const originals = element.parts.map((part) => originalText.get(part.id))
    if (originals.some((text) => text === undefined)) return
    setSaving(true)
    try {
      for (const [index, part] of element.parts.entries()) {
        const result = await props.api.client.part.update({ sessionID, messageID: part.messageID, partID: part.id, part: { ...part, text: originals[index]! } as Part })
        if (result.error) throw result.error
      }
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

  onMount(() => focusMessages())
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
  const leftActive = () => column() === "messages"
  const rightActive = () => column() === "editor"
  return (
    <box width={dimensions().width} height={dimensions().height} backgroundColor={skin.background} flexDirection="column" paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={skin.text}><b>Edit AI messages</b></text>
        <text fg={skin.textMuted}>{editing() ? "Ctrl+S/Esc save · Enter newline · Ctrl+C exit" : "↑/↓ select · ←/→ switch · Enter edit · R restore · Esc exit · Ctrl+C exit"}</text>
      </box>
      <text fg={skin.warning}>Edits update the stored transcript. They do not rerun prior responses or revise messages already generated.</text>
      <input
        ref={(value) => (searchInput = value)}
        onInput={(value) => {
          setSearch(value)
          setMessageIndex(0)
          setPartIndex(0)
        }}
        placeholder="Search final responses"
        placeholderColor={skin.textMuted}
        focusedBackgroundColor={skin.backgroundElement}
        focusedTextColor={skin.text}
        cursorColor={skin.primary}
      />
      <box flexDirection="row" flexGrow={1} gap={1}>
        <box width={Math.min(30, Math.max(22, Math.floor(dimensions().width * 0.26)))} flexDirection="column" border borderColor={leftActive() ? skin.borderActive : skin.border} paddingLeft={1} paddingRight={1} backgroundColor={leftActive() ? undefined : skin.backgroundPanel}>
          <text fg={leftActive() ? skin.primary : skin.textMuted}>Final responses ({filteredMessages().length}{search() ? `/${messages().length}` : ""})</text>
          {filteredMessages().length ? <scrollbox flexGrow={1}>{filteredMessages().map((message, index) => <box flexDirection="row" backgroundColor={index === messageIndex() && leftActive() ? skin.primary : undefined}><text flexShrink={0} fg={index === messageIndex() && leftActive() ? skin.selectedListItemText : skin.textMuted}>{index + 1}. </text><text flexGrow={1} wrapMode="word" fg={index === messageIndex() && leftActive() ? skin.selectedListItemText : skin.textMuted}>{messagePreview(message)}</text></box>)}</scrollbox> : <text fg={skin.textMuted}>No matching final responses.</text>}
        </box>
        <box flexGrow={1} flexDirection="column" border borderColor={rightActive() ? skin.borderActive : skin.border} paddingLeft={2} paddingRight={2} backgroundColor={rightActive() ? undefined : skin.backgroundPanel}>
          <text fg={rightActive() ? skin.primary : skin.textMuted} paddingBottom={1}>Response elements</text>
          {selectedMessage() ? <>
            <box flexDirection="column" paddingBottom={1}>{elements().map((element, index) => <box backgroundColor={index === partIndex() && rightActive() ? skin.primary : undefined}><text fg={index === partIndex() && rightActive() ? skin.selectedListItemText : skin.textMuted}>{element.label}</text></box>)}</box>
            <text fg={skin.textMuted} paddingBottom={1}>{editing() ? "Editing selected element" : "Preview (press Enter to edit)"}</text>
            {editing() && selectedElement() ? <box flexGrow={1} flexDirection="column" gap={1}>{selectedElement()!.parts.map((part, index) => <textarea ref={(value) => (textareas[index] = value)} initialValue={drafts()[index] ?? part.text} width="100%" flexGrow={1} minHeight={8} wrapMode="word" textColor={skin.text} focusedTextColor={skin.text} backgroundColor={skin.backgroundElement} focusedBackgroundColor={skin.backgroundElement} cursorColor={skin.primary} onContentChange={() => setDrafts((values) => values.map((value, valueIndex) => valueIndex === index ? textareas[index]?.plainText ?? "" : value))} />)}</box> : <box flexGrow={1} minHeight={8} backgroundColor={skin.backgroundElement} paddingLeft={1} paddingRight={1} paddingTop={1}><text fg={rightActive() ? skin.text : skin.textMuted}>{selectedElement()?.parts.map((part) => part.text).join("\n\n") || "(empty)"}</text></box>}
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
