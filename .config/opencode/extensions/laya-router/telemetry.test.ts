import assert from "node:assert/strict"
import test from "node:test"

import {
  aggregateModelUsage,
  aggregateAssistantMessageUsage,
  augmentTelemetryReport,
  formatTelemetryJson,
  formatTelemetryMarkdown,
  formatTelemetrySelectOptions,
  sumNativeSessionTotals,
  withNativeSessionTotals,
  type NativeSessionInfo,
} from "./telemetry.ts"

const session: NativeSessionInfo = {
  id: "root",
  agent: "build",
  model: { providerID: "openai", modelID: "gpt-5.6-sol", variant: "high" },
}

test("aggregates model usage by agent, model, variant, and kind", () => {
  const usage = aggregateModelUsage([
    { agent: "build", providerID: "openai", modelID: "sol", variant: "high", kind: "primary", timestamp: "2026-09-27T10:02:00Z" },
    { agent: "build", providerID: "openai", modelID: "sol", variant: "high", kind: "primary", timestamp: "2026-09-27T10:01:00Z" },
    { agent: "build", providerID: "openai", modelID: "sol", kind: "title", timestamp: "2026-09-27T10:03:00Z" },
  ])

  assert.deepEqual(usage, [
    {
      agent: "build", providerID: "openai", modelID: "sol", variant: "high", kind: "primary",
      requests: 2, firstTimestamp: "2026-09-27T10:01:00Z", lastTimestamp: "2026-09-27T10:02:00Z",
    },
    {
      agent: "build", providerID: "openai", modelID: "sol", kind: "title",
      requests: 1, firstTimestamp: "2026-09-27T10:03:00Z", lastTimestamp: "2026-09-27T10:03:00Z",
    },
  ])
})

test("Markdown explicitly reports missing telemetry without child sections", () => {
  const output = formatTelemetryMarkdown(session, undefined)

  assert.match(output, /ID: `root`/)
  assert.match(output, /Agent: build/)
  assert.match(output, /openai\/gpt-5\.6-sol#high/)
  assert.match(output, /Laya: telemetry unavailable/)
  assert.doesNotMatch(output, /Child sessions|child-1/)
})

test("Markdown displays Laya confidence, threshold, status, and usage counts", () => {
  const output = formatTelemetryMarkdown(session, {
    laya: { status: "routed", confidence: 0.875, threshold: 0.5 },
    usage: aggregateModelUsage([
      { agent: "build", providerID: "openai", modelID: "gpt-5.6-sol", kind: "primary", timestamp: "2026-09-27T10:00:00Z" },
    ]),
  })

  assert.match(output, /87\.5% confidence, 50% threshold, routed/)
  assert.match(output, /primary: 1 request/)
})

test("Markdown distinguishes a session with no Laya decision from a routing error", () => {
  const output = formatTelemetryMarkdown(session, {
    laya: { status: "not-evaluated", threshold: 0.5 },
    usage: [],
  })

  assert.match(output, /Laya: not evaluated for this session \(50% threshold\)/)
  assert.doesNotMatch(output, /unknown confidence|Error:/)
})

test("formats fallback profile and distinct confidence, probability, and margin", () => {
  const telemetry = {
    laya: {
      status: "fallback" as const,
      profile: "basic",
      effectiveProfile: "standard",
      model: "openai/sol#low",
      confidence: 0.42,
      choiceProbability: 0.7,
      margin: 0.3,
      threshold: 0.5,
      fallbackReason: "Confidence below threshold",
    },
    usage: [],
  }
  const markdown = formatTelemetryMarkdown(session, telemetry)
  assert.match(markdown, /42% confidence, 50% threshold, fallback/)
  assert.match(markdown, /Effective profile: standard/)
  assert.match(markdown, /Choice probability: 70%/)
  assert.match(markdown, /Margin: 30%/)
  assert.match(markdown, /Fallback reason: Confidence below threshold/)

  const options = formatTelemetrySelectOptions({
    session: { agent: "build", model: session.model }, telemetry,
    usage: aggregateAssistantMessageUsage([]),
  })
  const titles = options.map((option) => option.title).join("\n")
  assert.match(titles, /effective profile · standard/)
  assert.match(titles, /choice probability · 70%/)
  assert.match(titles, /margin · 30%/)
})

test("formats routing policy floor, reason, and version without prompt content", () => {
  const telemetry = { laya: { status: "routed" as const, threshold: 0.1, minimumProfile: "standard", decisionReason: "standard capability floor", policyVersion: "v1" }, usage: [] }
  const markdown = formatTelemetryMarkdown(session, telemetry)
  assert.match(markdown, /Minimum profile: standard/)
  assert.match(markdown, /Decision reason: standard capability floor/)
  assert.match(markdown, /Policy version: v1/)
  assert.doesNotMatch(JSON.stringify(telemetry), /prompt|request content/i)
})

test("JSON is parseable and omits undefined fields", () => {
  const output = formatTelemetryJson(session, undefined)
  const parsed = JSON.parse(output) as Record<string, unknown>

  assert.equal(parsed.telemetry, undefined)
  assert.equal(output.includes("undefined"), false)
  assert.equal(output.includes('"variant"'), true)
  assert.equal(parsed.children, undefined)
  assert.equal(JSON.stringify(JSON.parse(output), null, 2), output)
})

test("aggregates only completed assistant responses by agent and model with coverage", () => {
  const usage = aggregateAssistantMessageUsage([
    { type: "user", time: { completed: 1 }, cost: 99, tokens: { input: 99 } },
    { type: "assistant", agent: "build", model: { providerID: "openai", id: "sol", variant: "high" }, time: { completed: 1 }, cost: 0.25, tokens: { input: 10, output: 4, reasoning: 3, cache: { read: 2, write: 1 } } },
    { type: "assistant", agent: "build", providerID: "openai", modelID: "sol", variant: "high", time: { completed: 2 }, tokens: { input: 5, output: 6 } },
    { type: "assistant", agent: "reviewer", model: { providerID: "openai", id: "luna" }, time: { completed: 3 }, cost: 0.1 },
    { type: "assistant", agent: "ignored", time: {} },
  ])
  assert.deepEqual(usage.sessionTotals, { input: 15, output: 10, reasoning: 3, cacheRead: 2, cacheWrite: 1, totalTokens: 25, estimatedCost: 0.35, costSource: "native" })
  assert.equal(usage.messageTotals.requests, 3)
  assert.equal(usage.messageTotals.tokenResponses, 2)
  assert.equal(usage.messageTotals.costResponses, 2)
  assert.equal(usage.byAgent.length, 2)
  assert.equal(usage.byModel.length, 2)
  assert.equal(usage.byAgent[0]?.totalTokens, 25)
  assert.equal(usage.byModel[0]?.requests, 2)
})

test("ignores empty and non-finite usage metadata when calculating coverage", () => {
  const usage = aggregateAssistantMessageUsage([
    { type: "assistant", agent: "build", time: { completed: 1 }, tokens: {}, cost: Number.NaN },
    { type: "assistant", agent: "build", time: { completed: 2 }, tokens: { input: Number.POSITIVE_INFINITY }, cost: Number.NEGATIVE_INFINITY },
    { type: "assistant", agent: "build", time: { completed: 3 }, tokens: { output: 4 }, cost: 0.2 },
  ])

  assert.equal(usage.messageTotals.requests, 3)
  assert.equal(usage.messageTotals.tokenResponses, 1)
  assert.equal(usage.messageTotals.costResponses, 1)
  assert.equal(usage.messageTotals.output, 4)
  assert.equal(usage.messageTotals.estimatedCost, 0.2)
})

test("safely sums finite native totals across a session family", () => {
  assert.deepEqual(sumNativeSessionTotals([
    { cost: 1.25, tokens: { input: 10, output: 4, reasoning: 2, cache: { read: 3, write: 1 } } },
    { cost: 0.75, tokens: { input: 5, output: 6, reasoning: Number.NaN, cache: { read: Number.POSITIVE_INFINITY, write: 2 } } },
  ]), { input: 15, output: 10, reasoning: 2, cacheRead: 3, cacheWrite: 3, totalTokens: 25, estimatedCost: 2, costSource: "native" })
})

test("augments Markdown and JSON with separate lifetime agent and model usage", () => {
  const usage = withNativeSessionTotals(
    aggregateAssistantMessageUsage([{ type: "assistant", agent: "build", model: { providerID: "openai", id: "sol" }, time: { completed: 1 }, cost: 0.2, tokens: { input: 7, output: 3 } }]),
    { cost: 2.5, tokens: { input: 100, output: 50, reasoning: 12, cache: { read: 20, write: 5 } } },
  )
  const markdown = augmentTelemetryReport(formatTelemetryMarkdown(session, undefined), "markdown", usage)
  assert.match(markdown, /Lifetime session-family usage \(1 session\)/)
  assert.match(markdown, /\| 100 \| 50 \| 12 \| 20 \| 5 \| 150 \| 2\.5 \|/)
  assert.match(markdown, /Completed assistant responses: 1; token data recorded for 1; cost data recorded for 1/)
  assert.match(markdown, /\| build \| 1 \| 7 \| 3 \| 0 \| 0 \| 0 \| 10 \| 0\.2 \| 1\/1 \| 1\/1 \|/)
  assert.match(markdown, /\| openai\/sol \| 1 \| 7 \| 3 \| 0 \| 0 \| 0 \| 10 \| 0\.2 \| 1\/1 \| 1\/1 \|/)
  const json = JSON.parse(augmentTelemetryReport(formatTelemetryJson(session, undefined), "json", usage)) as { usage: typeof usage }
  assert.equal(json.usage.sessionTotals.totalTokens, 150)
  assert.equal(json.usage.sessionTotals.estimatedCost, 2.5)
  assert.equal(json.usage.messageTotals.totalTokens, 10)
  assert.equal(json.usage.messageTotals.estimatedCost, 0.2)
  assert.equal(json.usage.messageTotals.tokenResponses, 1)
  assert.equal(json.usage.byAgent[0]?.agent, "build")
})

test("formats telemetry as short, split rows without losing usage details", () => {
  const usage = withNativeSessionTotals(
    aggregateAssistantMessageUsage([{ type: "assistant", agent: "build", model: { providerID: "openai", id: "sol" }, time: { completed: 1 }, cost: 0.000123, tokens: { input: 45170, output: 10, reasoning: 4, cache: { read: 3, write: 2 } } }]),
    { cost: 0.000456, tokens: { input: 45170, output: 10, reasoning: 4, cache: { read: 3, write: 2 } } },
  )
  const report = augmentTelemetryReport(formatTelemetryJson(session, {
    laya: { status: "routed", profile: "complex", confidence: 0.9, threshold: 0.5, model: "openai/sol", probabilities: { complex: 0.9 } },
    usage: [],
  }), "json", usage)
  const options = formatTelemetrySelectOptions(report)
  const titles = (category: string) => options.filter((option) => option.category === category).map((option) => option.title).join("\n")
  assert.match(titles("Session"), /ID · root\nAgent · build\nModel · openai\/gpt-5\.6-sol#high/)
  assert.match(titles("Session"), /Laya status · routed\nprofile · complex\nconfidence 90% · threshold 50%\nrouted model · openai\/sol\nprobability · complex 90%/)
  assert.match(titles("Usage"), /total 45,180.*in 45,170 · out 10.*reason 4.*cache read 3.*cache write 2.*est\. cost \$0\.000456 USD/s)
  for (const category of ["By agent", "By model"]) {
    assert.match(titles(category), /total 45,180.*in 45,170 · out 10.*reason 4.*cache read 3.*cache write 2.*est\. cost \$0\.000123 USD.*requests 1.*token metadata 1\/1.*cost metadata 1\/1/s)
  }
  assert.equal(options.every((option) => `${option.title}${option.description ?? ""}`.length <= 64), true)
  assert.equal(new Set(options.map((option) => option.value)).size, options.length)
  assert.equal(options.some((option) => /2026-|firstTimestamp|lastTimestamp/.test(`${option.title} ${option.description}`)), false)
})

test("bounds long identity display while retaining its full value", () => {
  const identity = `agent-${"x".repeat(100)}`
  const modelID = `model-${"y".repeat(100)}`
  const usage = aggregateAssistantMessageUsage([{ type: "assistant", agent: identity, model: { providerID: "provider", id: modelID }, time: { completed: 1 }, tokens: { input: 1, output: 2 } }])
  const options = formatTelemetrySelectOptions({ session: { agent: identity, model: { providerID: "provider", modelID } }, usage })
  const identities = options.filter((option) => option.value.endsWith(":identity") || option.value.startsWith("session:"))
  assert.equal(identities.every((option) => option.title.length <= 64), true)
  assert.equal(options.some((option) => option.value.includes(identity)), true)
  assert.equal(options.some((option) => option.value.includes(modelID)), true)
})

test("bounds long Laya profile and error rows while retaining full values", () => {
  const profile = `profile-${"p".repeat(100)}`
  const error = `error-${"e".repeat(100)}`
  const usage = aggregateAssistantMessageUsage([])
  const options = formatTelemetrySelectOptions({
    session: { id: "session", agent: "build", model: { providerID: "openai", modelID: "sol" } },
    telemetry: { laya: { status: "classification-error", profile, threshold: 0.5, error }, usage: [] },
    usage,
  })

  assert.equal(options.every((option) => option.title.length <= 64), true)
  assert.equal(options.some((option) => option.value.includes(profile)), true)
  assert.equal(options.some((option) => option.value.includes(error)), true)
})

test("uses unique model row values for display-identical model tuples", () => {
  const empty = { requests: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, estimatedCost: 0, tokenResponses: 0, costResponses: 0 }
  const usage = {
    sessionCount: 1,
    sessionTotals: empty,
    messageTotals: empty,
    byAgent: [],
    byModel: [
      { ...empty, providerID: "a", modelID: "b#c" },
      { ...empty, providerID: "a", modelID: "b", variant: "c" },
    ],
  }
  const options = formatTelemetrySelectOptions({ session: { agent: "build", model: { providerID: "a", modelID: "b" } }, usage })
  const values = options.map((option) => option.value)

  assert.equal(new Set(values).size, values.length)
})

test("keeps safe-integer usage rows within the non-wrapping width", () => {
  const maximum = Number.MAX_SAFE_INTEGER
  const totals = { requests: maximum, input: maximum, output: maximum, reasoning: maximum, cacheRead: maximum, cacheWrite: maximum, totalTokens: maximum, estimatedCost: 999999999.123456, tokenResponses: maximum, costResponses: maximum }
  const usage = {
    sessionCount: 1,
    sessionTotals: totals,
    messageTotals: totals,
    byAgent: [{ ...totals, agent: "build" }],
    byModel: [{ ...totals, providerID: "openai", modelID: "sol" }],
  }
  const options = formatTelemetrySelectOptions({ session: { agent: "build", model: { providerID: "openai", modelID: "sol" } }, usage })

  assert.equal(options.every((option) => option.title.length <= 64), true)
})
