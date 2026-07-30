import { expect, test } from "bun:test"
import { assistantMessages, editableParts, partLabel, preview } from "../src/utils.js"

test("selects assistant messages only", () => {
  expect(assistantMessages([{ id: "u", role: "user" }, { id: "a", role: "assistant" }])).toEqual([{ id: "a", role: "assistant" }])
})

test("selects text and reasoning edit targets and labels them", () => {
  const parts = editableParts([
    { type: "tool" },
    { type: "text", text: "incomplete" },
    { id: "r", messageID: "m", sessionID: "s", type: "reasoning", text: "thought" },
    { id: "t", messageID: "m", sessionID: "s", type: "text", text: "answer" },
  ])
  expect(parts.map((part, index) => partLabel(part, index, parts.length))).toEqual(["Reasoning 1", "Final response 2"])
})

test("creates a compact single-line preview", () => {
  expect(preview("  one\n two  ")).toBe("one two")
  expect(preview("abcdef", 4)).toBe("abc…")
})
