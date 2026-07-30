/** @jsxImportSource @opentui/solid */
import { createMemo, createSignal, onCleanup } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { useBindings } from "@opentui/keymap/solid"
import type { Message, Part } from "@opencode-ai/sdk/v2"
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { assistantMessages, editableParts, partLabel, preview, type EditablePart } from "./utils.js"

const routeName = "opencode-edit-messages"
const modeName = "opencode-edit-messages"
const command = {
  open: "opencode-edit-messages.open",
  close: "opencode-edit-messages.close",
  focusLeft: "opencode-edit-messages.focus-left",
  focusRight: "opencode-edit-messages.focus-right",
  previous: "opencode-edit-messages.previous",
  next: "opencode-edit-messages.next",
  edit: "opencode-edit-messages.edit",
}

type RouteParams = { sessionID?: string }

const currentSessionID = (api: TuiPluginApi) =>
  api.route.current.name === "session" ? api.route.current.params?.sessionID : undefined

function MessageEditor(props: { api: TuiPluginApi; sessionID: string; part: EditablePart; onClose: () => void }) {
  const [text, setText] = createSignal(props.part.text)
  const [saving, setSaving] = createSignal(false)
  let area: { plainText: string } | undefined

  const save = async () => {
    if (saving()) return
    setSaving(true)
    try {
      const result = await props.api.client.part.update({
        sessionID: props.sessionID,
        messageID: props.part.messageID,
        partID: props.part.id,
        part: { ...props.part, text: text() } as Part,
      })
      if (result.error) throw result.error
      props.api.ui.toast({ variant: "success", title: "Message updated", message: "The persisted transcript was updated." })
      props.onClose()
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

  return (
    <box flexDirection="column" gap={1} paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1}>
      <text fg={props.api.theme.current.text}><b>Edit {partLabel(props.part, 0, 1)}</b></text>
      <text fg={props.api.theme.current.warning}>Edits change the persisted transcript only. They do not regenerate or alter subsequent model context.</text>
      <textarea
        ref={(value) => (area = value)}
        initialValue={props.part.text}
        width="100%"
        minHeight={8}
        maxHeight={20}
        wrapMode="word"
        textColor={props.api.theme.current.text}
        focusedTextColor={props.api.theme.current.text}
        backgroundColor={props.api.theme.current.backgroundElement}
        focusedBackgroundColor={props.api.theme.current.backgroundElement}
        cursorColor={props.api.theme.current.primary}
        focused
        onContentChange={() => setText(area?.plainText ?? "")}
        onSubmit={() => void save()}
        onKeyDown={(event) => {
          if (event.name === "escape") {
            event.preventDefault()
            props.onClose()
          }
        }}
      />
      <text fg={props.api.theme.current.textMuted}>{saving() ? "Saving…" : "Enter saves · Esc cancels"}</text>
    </box>
  )
}

function EditorRoute(props: { api: TuiPluginApi; params?: Record<string, unknown> }) {
  const dimensions = useTerminalDimensions()
  const sessionID = typeof props.params?.sessionID === "string" ? props.params.sessionID : ""
  const [revision, setRevision] = createSignal(0)
  const [messageIndex, setMessageIndex] = createSignal(0)
  const [partIndex, setPartIndex] = createSignal(0)
  const [column, setColumn] = createSignal<"messages" | "content">("messages")
  const popMode = props.api.mode.push(modeName)
  onCleanup(popMode)

  const refresh = () => setRevision((value) => value + 1)
  const unsubs = [
    props.api.event.on("message.updated", (event) => event.properties.sessionID === sessionID && refresh()),
    props.api.event.on("message.removed", (event) => event.properties.sessionID === sessionID && refresh()),
    props.api.event.on("message.part.updated", (event) => event.properties.sessionID === sessionID && refresh()),
    props.api.event.on("message.part.removed", (event) => event.properties.sessionID === sessionID && refresh()),
  ]
  onCleanup(() => unsubs.forEach((unsubscribe) => unsubscribe()))

  const messages = createMemo(() => {
    revision()
    return assistantMessages(props.api.state.session.messages(sessionID) as readonly Message[])
  })
  const selectedMessage = createMemo(() => messages()[Math.min(messageIndex(), Math.max(0, messages().length - 1))])
  const parts = createMemo(() => {
    revision()
    const message = selectedMessage()
    return message ? editableParts(props.api.state.part(message.id) as readonly Part[]) : []
  })
  const messagePreview = (message: Message) => {
    const text = editableParts(props.api.state.part(message.id) as readonly Part[])
      .map((part) => part.text)
      .join(" ")
    return preview(text, 38)
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
  const openPart = () => {
    const part = parts()[partIndex()]
    if (!part) return
    props.api.ui.dialog.setSize("xlarge")
    props.api.ui.dialog.replace(() => <MessageEditor api={props.api} sessionID={sessionID} part={part} onClose={() => props.api.ui.dialog.clear()} />)
  }

  useBindings(() => ({
    mode: modeName,
    enabled: () => props.api.route.current.name === routeName && !props.api.ui.dialog.open,
    commands: [
      { name: command.close, run: () => props.api.route.navigate("session", { sessionID }) },
      { name: command.focusLeft, run: () => setColumn("messages") },
      { name: command.focusRight, run: () => setColumn("content") },
      { name: command.previous, run: () => (column() === "messages" ? moveMessage(-1) : movePart(-1)) },
      { name: command.next, run: () => (column() === "messages" ? moveMessage(1) : movePart(1)) },
      { name: command.edit, run: openPart },
    ],
    bindings: [
      { key: "escape", cmd: command.close, desc: "Return to session" },
      { key: "left", cmd: command.focusLeft, desc: "Focus messages" },
      { key: "right", cmd: command.focusRight, desc: "Focus content" },
      { key: "up", cmd: command.previous, desc: "Previous" },
      { key: "down", cmd: command.next, desc: "Next" },
      { key: "enter", cmd: command.edit, desc: "Edit part" },
    ],
  }))

  const skin = props.api.theme.current
  return (
    <box width={dimensions().width} height={dimensions().height} backgroundColor={skin.background} flexDirection="column" paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between" paddingBottom={1}>
        <text fg={skin.text}><b>Edit AI messages</b></text>
        <text fg={skin.textMuted}>Esc return · ←/→ focus · ↑/↓ select · Enter edit</text>
      </box>
      <text fg={skin.warning} paddingBottom={1}>Warning: edits change the persisted transcript only. They do not regenerate or alter subsequent model context.</text>
      <box flexDirection="row" flexGrow={1} gap={1}>
        <box width="42%" flexDirection="column" border borderColor={column() === "messages" ? skin.borderActive : skin.border} paddingLeft={1} paddingRight={1}>
          <text fg={skin.primary} paddingBottom={1}>Assistant messages ({messages().length})</text>
           {messages().length ? messages().map((message, index) => <box backgroundColor={index === messageIndex() ? skin.primary : undefined}><text fg={index === messageIndex() ? skin.selectedListItemText : skin.textMuted}> {index === messageIndex() ? "›" : " "} {messagePreview(message)}</text></box>) : <text fg={skin.textMuted}>No assistant messages in this session.</text>}
        </box>
        <box flexGrow={1} flexDirection="column" border borderColor={column() === "content" ? skin.borderActive : skin.border} paddingLeft={1} paddingRight={1}>
          <text fg={skin.primary} paddingBottom={1}>Editable content ({parts().length})</text>
          {parts().length ? parts().map((part, index) => <box flexDirection="column" paddingBottom={1} backgroundColor={index === partIndex() ? skin.backgroundElement : undefined}><text fg={index === partIndex() ? skin.selectedListItemText : skin.text}>{index === partIndex() ? "› " : "  "}{partLabel(part, index, parts().length)}</text><text fg={skin.textMuted}>   {preview(part.text, 76)}</text></box>) : <text fg={skin.textMuted}>Select an assistant message with a text or reasoning part.</text>}
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
    commands: [{ name: command.open, title: "Edit AI messages", category: "Plugin", namespace: "palette", slashName: "edit-messages", run: open }],
    bindings: [{ key: "<leader>e", cmd: command.open, desc: "Edit AI messages" }],
  })
  api.route.register([{ name: routeName, render: ({ params }) => <EditorRoute api={api} params={params} /> }])
}

export default { id: routeName, tui } satisfies TuiPluginModule
