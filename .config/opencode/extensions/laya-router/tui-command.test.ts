import assert from "node:assert/strict"
import test from "node:test"

import { registerTelemetryTuiCommand, runTelemetryCommand } from "./tui-command.ts"

test("shows Markdown telemetry using only the read-only report callback", async () => {
  const calls: string[] = []

  await runTelemetryCommand(undefined, {
    getSessionID: () => "session-1",
    getReport: async ({ sessionID, format }) => {
      calls.push(`report:${sessionID}:${format}`)
      return "# Session telemetry"
    },
    showReport: async (report, format) => { calls.push(`show:${format}:${report}`) },
    notify: (message) => { calls.push(`notify:${message}`) },
  })

  assert.deepEqual(calls, ["report:session-1:markdown", "show:markdown:# Session telemetry"])
})

test("routes the exact --json argument to JSON display", async () => {
  let selectedFormat = ""

  await runTelemetryCommand("--json", {
    getSessionID: () => "session-1",
    getReport: async ({ format }) => { selectedFormat = format; return "{}" },
    showReport: async (_report, format) => { selectedFormat = format },
    notify: () => assert.fail("valid JSON argument must not notify"),
  })

  assert.equal(selectedFormat, "json")
})

test("rejects unknown arguments without requesting telemetry", async () => {
  let requested = false
  const notifications: string[] = []

  await runTelemetryCommand("--jsonfoo", {
    getSessionID: () => "session-1",
    getReport: async () => { requested = true; return "{}" },
    showReport: async () => {},
    notify: (message) => notifications.push(message),
  })

  assert.equal(requested, false)
  assert.deepEqual(notifications, ["Usage: /session-telemetry [--json]"])
})

test("notifies instead of doing work outside a session", async () => {
  let requested = false
  const notifications: string[] = []

  await runTelemetryCommand(undefined, {
    getSessionID: () => undefined,
    getReport: async () => { requested = true; return "{}" },
    showReport: async () => {},
    notify: (message) => notifications.push(message),
  })

  assert.equal(requested, false)
  assert.deepEqual(notifications, ["Open a session before requesting session telemetry."])
})

test("shows a local notification when the read-only RPC fails", async () => {
  const notifications: string[] = []

  await runTelemetryCommand(undefined, {
    getSessionID: () => "session-1",
    getReport: async () => { throw new Error("server unavailable") },
    showReport: async () => assert.fail("report should not be shown"),
    notify: (message) => notifications.push(message),
  })

  assert.deepEqual(notifications, ["Could not load session telemetry: Error: server unavailable"])
})

test("registers a slash command that only calls the report RPC and opens a dialog", async () => {
  let command: { slash?: { name: string; arguments?: true }; run(input?: string): void | false | Promise<void> } | undefined
  const sideEffects: string[] = []

  registerTelemetryTuiCommand({
    keymap: {
      layer: (factory) => {
        const layer = factory()
        command = layer.commands?.[0]
        return undefined
      },
    },
    currentRoute: () => ({ type: "session", sessionID: "session-2" }),
    getReport: async ({ sessionID, format }) => {
      sideEffects.push(`read:${sessionID}:${format}`)
      return "report text"
    },
    showReport: async (report) => { sideEffects.push(`dialog:${report}`) },
    notify: (message) => { sideEffects.push(`notify:${message}`) },
  })

  assert.ok(command)
  assert.deepEqual(command.slash, { name: "session-telemetry", arguments: true })
  await command.run("--json")

  assert.deepEqual(sideEffects, ["read:session-2:json", "dialog:report text"])
})
