import assert from "node:assert/strict"
import test from "node:test"

import tuiPlugin from "./tui.ts"

test("registers the keymap layer only when the app slot is rendered", () => {
  let renderSlot: (() => null) | undefined
  let appendedSlot: string | undefined
  let keymapRegistered = false

  tuiPlugin.setup({
    client: { rpc: () => ({ get: async () => ({ report: "telemetry" }) }) },
    keymap: {
      layer: () => { keymapRegistered = true },
    },
    ui: {
      slot: ({ append, render }: { append: "app"; render: () => null }) => {
        appendedSlot = append
        renderSlot = render
        return () => {}
      },
      router: { current: () => ({ type: "session", sessionID: "session-1" }) },
      dialog: { alert: async () => {} },
      toast: { show: () => {} },
    },
  } as never)

  assert.equal(appendedSlot, "app")
  assert.equal(keymapRegistered, false)
  assert.ok(renderSlot)
  assert.equal(renderSlot(), null)
  assert.equal(keymapRegistered, true)
})

test("deduplicates and aggregates only the current session family before augmenting JSON", async () => {
  let renderSlot: (() => null) | undefined
  let command: { run(input?: string): Promise<void> | void | false } | undefined
  const calls: string[] = []
  let displayed = ""
  tuiPlugin.setup({
    client: { rpc: () => ({ get: async ({ sessionID }: { sessionID: string }) => { calls.push(`rpc:${sessionID}`); return { report: JSON.stringify({ session: { id: sessionID } }) } } }) },
    data: { session: {
      family: (sessionID: string) => { calls.push(`family:${sessionID}`); return ["current", "child", "child"] },
      sync: async (sessionID: string) => { calls.push(`session-sync:${sessionID}`) },
      get: (sessionID: string) => { calls.push(`session-get:${sessionID}`); return sessionID === "current" ? { cost: 1.5, tokens: { input: 20, output: 5 } } : { cost: 0.5, tokens: { input: 7, output: 3 } } },
      message: {
        sync: async (sessionID: string) => { calls.push(`message-sync:${sessionID}`) },
        list: (sessionID: string) => { calls.push(`message-list:${sessionID}`); return [{ type: "assistant", agent: sessionID === "current" ? "build" : "implementer", model: { providerID: "openai", id: sessionID === "current" ? "sol" : "luna" }, time: { completed: 1 }, cost: 1, tokens: { input: 10, output: 2 } }] },
      },
    } },
    keymap: { layer: (factory: () => { commands?: Array<{ run(input?: string): Promise<void> | void | false }> }) => { command = factory().commands?.[0] } },
    ui: {
      slot: ({ render }: { append: "app"; render: () => null }) => { renderSlot = render; return () => {} },
      router: { current: () => ({ type: "session", sessionID: "current" }) },
      dialog: { alert: async ({ message }: { message: string }) => { displayed = message } },
      toast: { show: () => {} },
    },
  } as never)
  renderSlot?.()
  await command?.run("--json")
  assert.deepEqual(calls, ["rpc:current", "family:current", "session-sync:current", "message-sync:current", "message-list:current", "session-get:current", "session-sync:child", "message-sync:child", "message-list:child", "session-get:child"])
  const report = JSON.parse(displayed) as { usage: { sessionCount: number; sessionTotals: { totalTokens: number; estimatedCost: number }; byAgent: Array<{ agent: string }>; byModel: Array<{ modelID: string }> }; children?: unknown }
  assert.equal(report.usage.sessionCount, 2)
  assert.equal(report.usage.sessionTotals.totalTokens, 35)
  assert.equal(report.usage.sessionTotals.estimatedCost, 2)
  assert.deepEqual(report.usage.byAgent.map(({ agent }) => agent), ["build", "implementer"])
  assert.deepEqual(report.usage.byModel.map(({ modelID }) => modelID), ["sol", "luna"])
  assert.equal(report.children, undefined)
})

test("default command displays a scrollable select with lifetime, agent, and model totals", async () => {
  let renderSlot: (() => null) | undefined
  let command: { run(input?: string): Promise<void> | void | false } | undefined
  let alertCalled = false
  let selected: Array<{ title: string; description?: string; category?: string }> = []
  tuiPlugin.setup({
    client: { rpc: () => ({ get: async () => ({ report: JSON.stringify({
      session: { id: "current", agent: "build", model: { providerID: "openai", modelID: "sol" } },
      telemetry: { laya: { status: "routed", profile: "complex", confidence: 0.8, threshold: 0.5, model: "openai/sol" }, usage: [{ firstTimestamp: "2026-09-27", lastTimestamp: "2026-09-27" }] },
    }) }) }) },
    data: { session: {
      family: () => [],
      sync: async () => {}, get: () => ({ cost: 1.25, tokens: { input: 45000, output: 180 } }),
      message: { sync: async () => {}, list: () => [{ type: "assistant", agent: "build", model: { providerID: "openai", id: "sol" }, time: { completed: 1 }, cost: 0.5, tokens: { input: 1000, output: 50 } }] },
    } },
    keymap: { layer: (factory: () => { commands?: Array<{ run(input?: string): Promise<void> | void | false }> }) => { command = factory().commands?.[0] } },
    ui: {
      slot: ({ render }: { append: "app"; render: () => null }) => { renderSlot = render; return () => {} },
      router: { current: () => ({ type: "session", sessionID: "current" }) },
      dialog: {
        alert: async () => { alertCalled = true },
        select: async ({ options }: { options: typeof selected }) => { selected = options },
      },
      toast: { show: () => {} },
    },
  } as never)
  renderSlot?.()
  await command?.run()
  assert.equal(alertCalled, false)
  assert.equal(selected.some((option) => option.title === "Lifetime session-family total · 1 session"), true)
  assert.equal(selected.some((option) => option.category === "Usage" && option.title.includes("total 45,180")), true)
  assert.equal(selected.some((option) => option.category === "By agent" && option.title.includes("total 1,050")), true)
  assert.equal(selected.some((option) => option.category === "By model" && option.title.includes("total 1,050")), true)
  assert.deepEqual(new Set(selected.map((option) => option.category).filter(Boolean)), new Set(["Summary", "Session", "Usage", "By agent", "By model"]))
  assert.equal(selected.some((option) => /timestamp|2026-09-27/i.test(`${option.title} ${option.description}`)), false)
})
