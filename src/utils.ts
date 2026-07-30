export type MessageLike = { id: string; role: string }

export type EditablePart = {
  id: string
  messageID: string
  sessionID: string
  type: "text" | "reasoning"
  text: string
  ignored?: boolean
  synthetic?: boolean
  [key: string]: unknown
}

export const assistantMessages = <Message extends MessageLike>(messages: readonly Message[]) =>
  messages.filter((message) => message.role === "assistant")

export const editableParts = (parts: readonly { type: string }[]): EditablePart[] =>
  parts.filter(
    (part): part is EditablePart =>
      (part.type === "text" || part.type === "reasoning") &&
      "id" in part &&
      "messageID" in part &&
      "sessionID" in part &&
      "text" in part,
  )

export const finalResponseParts = (parts: readonly { type: string }[]) =>
  editableParts(parts).filter(
    (part) => part.type === "text" && part.text.trim().length > 0 && part.ignored !== true && part.synthetic !== true,
  )

export const partLabel = (part: EditablePart, index: number, total: number) => {
  const kind = part.type === "reasoning" ? "Reasoning" : "Final response"
  return total > 1 ? `${kind} ${index + 1}` : kind
}

export const preview = (text: string, width = 54) => {
  const normalized = text
    .replace(/```[^\n]*\n([\s\S]*?)```/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/(?:\*\*|__|~~|\*|_)/g, "")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*[-+*]\s+/gm, "")
    .replace(/^\s*\d+[.)]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim()
  return normalized.length > width ? `${normalized.slice(0, Math.max(0, width - 1))}…` : normalized || "(empty)"
}
