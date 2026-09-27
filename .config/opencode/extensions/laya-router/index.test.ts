import assert from "node:assert/strict"
import test from "node:test"

import router, { buildTelemetryReport, isSubstantiveRoutingPrompt, normalizeRoutingAgents, routePrompt, validateRouterOptions, type ModelRoute, type RoutePromptDependencies } from "./index.ts"

const lunaRoute: ModelRoute = {
  profile: "basic",
  model: { providerID: "openai", id: "gpt-5.6-luna", variant: "low" },
  confidence: 0.9,
}

const dependencies = (overrides: Partial<RoutePromptDependencies> = {}): RoutePromptDependencies => ({
  getSession: async () => ({}),
  wasRouted: async () => false,
  markRouted: async () => {},
  classify: async () => lunaRoute,
  switchModel: async () => {},
  minimumChoiceProbability: 0,
  minimumMargin: 0,
  ...overrides,
})

test("routes the first primary-session prompt to the classified model", async () => {
  const selected: ModelRoute["model"][] = []
  const metadata: Record<string, unknown> = {}

  await routePrompt(
    { sessionID: "root", text: "Summarize this paragraph", metadata },
    dependencies({ switchModel: async (_sessionID, model) => void selected.push(model) }),
  )

  assert.deepEqual(selected, [lunaRoute.model])
  assert.deepEqual(metadata.laya, {
    selectedProfile: "basic",
    profile: "basic",
    model: "openai/gpt-5.6-luna#low",
    confidence: 0.9,
    effectiveProfile: "basic",
    decisionReason: "basic classification passed policy gates",
    policyVersion: "2026-09-27-v4",
  })
})

test("records routed profile, confidence, threshold, and classifier probabilities", async () => {
  let recorded: unknown

  await routePrompt(
    { sessionID: "root", text: "Summarize this paragraph", metadata: {} },
    dependencies({
      classify: async () => ({ ...lunaRoute, probabilities: { basic: 0.9, standard: 0.1 } }),
      recordLaya: async (_sessionID, result) => { recorded = result },
    }),
  )

  assert.deepEqual(recorded, {
    status: "routed",
    profile: "basic",
    model: "openai/gpt-5.6-luna#low",
    confidence: 0.9,
    threshold: 0.5,
    probabilities: { basic: 0.9, standard: 0.1 },
    effectiveProfile: "basic",
    decisionReason: "basic classification passed policy gates",
    policyVersion: "2026-09-27-v4",
  })
})

test("never routes child sessions", async () => {
  let classified = false
  let recorded: unknown

  await routePrompt(
    { sessionID: "child", text: "Run npm test", metadata: {} },
    dependencies({
      getSession: async () => ({ parentID: "root" }),
      recordLaya: async (_sessionID, result) => { recorded = result },
      classify: async () => {
        classified = true
        return lunaRoute
      },
    }),
  )

  assert.equal(classified, false)
  assert.deepEqual(recorded, { status: "child-bypassed", threshold: 0.5 })
})

test("plan reuses its persisted routing decision", async () => {
  let classified = false

  await routePrompt(
    { sessionID: "root", text: "Continue", metadata: {} },
    dependencies({
      session: { agent: "plan" },
      wasRouted: async () => true,
      classify: async () => {
        classified = true
        return lunaRoute
      },
    }),
  )

  assert.equal(classified, false)
})

test("native planning always receives the advanced model minimum", async () => {
  let selected: ModelRoute["model"] | undefined
  await routePrompt({ sessionID: "plan-floor", text: "Outline a straightforward implementation", metadata: {} }, dependencies({
    session: { agent: "plan" },
    routingAgents: new Set(["plan"]),
    classify: async () => ({ ...lunaRoute, profile: "basic" }),
    switchModel: async (_sessionID, model) => { selected = model },
  }))
  assert.deepEqual(selected, { providerID: "openai", id: "gpt-6-sol", variant: "low" })
})

test("native planning reroutes a persisted lower profile to the advanced minimum", async () => {
  let selected: ModelRoute["model"] | undefined
  await routePrompt({ sessionID: "old-plan", text: "Continue the plan", metadata: {} }, dependencies({
    session: { agent: "plan" },
    routingAgents: new Set(["plan"]),
    wasRouted: async () => true,
    getRoutingCompletion: async () => ({ status: "routed", effectiveProfile: "standard", policyVersion: "old", timestamp: "old" }),
    classify: async () => ({ ...lunaRoute, profile: "standard" }),
    switchModel: async (_sessionID, model) => { selected = model },
  }))
  assert.deepEqual(selected, { providerID: "openai", id: "gpt-6-sol", variant: "low" })
})

test("auto reevaluates the profile on every substantive prompt", async () => {
  let classified = 0
  let routed = false
  const selected: ModelRoute["model"][] = []
  const deps = dependencies({
    session: { agent: "auto" },
    routingAgents: new Set(["auto", "plan"]),
    wasRouted: async () => routed,
    markRouted: async () => { routed = true },
    classify: async () => {
      classified += 1
      return classified === 1
        ? lunaRoute
        : { profile: "deep", model: { providerID: "openai", id: "gpt-6-sol", variant: "high" }, confidence: 0.9 }
    },
    switchModel: async (_sessionID, model) => { selected.push(model) },
  })

  await routePrompt({ sessionID: "auto-repeat", text: "Explain gravity simply", metadata: {} }, deps)
  await routePrompt({ sessionID: "auto-repeat", text: "Plan a production migration", metadata: {} }, deps)

  assert.equal(classified, 2)
  assert.deepEqual(selected, [
    { providerID: "openai", id: "gpt-5.6-luna", variant: "low" },
    { providerID: "openai", id: "gpt-6-sol", variant: "high" },
  ])
})

test("serializes concurrent first prompts so Laya runs only once", async () => {
  let classified = 0
  let releaseClassification: (() => void) | undefined
  let signalClassificationStarted: (() => void) | undefined
  const classificationStarted = new Promise<void>((resolve) => { signalClassificationStarted = resolve })
  const classificationGate = new Promise<void>((resolve) => { releaseClassification = resolve })
  let marked = false
  const dependenciesForRace = dependencies({
    wasRouted: async () => marked,
    markRouted: async () => { marked = true },
    classify: async () => {
      classified += 1
      signalClassificationStarted?.()
      await classificationGate
      return lunaRoute
    },
  })

  const first = routePrompt({ sessionID: "root-race", text: "First", metadata: {} }, dependenciesForRace)
  await classificationStarted
  const second = routePrompt({ sessionID: "root-race", text: "Second", metadata: {} }, dependenciesForRace)
  releaseClassification?.()
  await Promise.all([first, second])

  assert.equal(classified, 1)
})

test("does not reclassify when persisting a Laya decision fails", async () => {
  let classified = 0
  let marked = false
  const dependenciesWithStorageFailure = dependencies({
    wasRouted: async () => marked,
    markRouted: async () => { marked = true },
    classify: async () => {
      classified += 1
      return lunaRoute
    },
    recordLaya: async () => { throw new Error("storage unavailable") },
  })

  await assert.rejects(() => routePrompt(
    { sessionID: "root-storage-failure", text: "First", metadata: {} },
    dependenciesWithStorageFailure,
  ), /storage unavailable/)
  await routePrompt(
    { sessionID: "root-storage-failure", text: "Second", metadata: {} },
    dependenciesWithStorageFailure,
  )

  assert.equal(marked, true)
  assert.equal(classified, 1)
})

test("policy-resolved low-risk uncertainty stays on basic as a routed decision", async () => {
  const switched: ModelRoute["model"][] = []
  let marked = false
  let recorded: unknown

  await routePrompt(
    { sessionID: "root", text: "Do something", metadata: {} },
    dependencies({
      classify: async () => ({ ...lunaRoute, confidence: 0.49 }),
      recordLaya: async (_sessionID, result) => { recorded = result },
      fallbackProfile: "standard",
      fallbackModel: { providerID: "openai", id: "sol" },
      switchModel: async (_sessionID, model) => { switched.push(model) },
      markRouted: async () => {
        marked = true
      },
    }),
  )

  assert.deepEqual(switched, [{ providerID: "openai", id: "gpt-5.6-luna", variant: "low" }])
  assert.equal(marked, true)
  assert.deepEqual(recorded, {
    status: "routed",
    threshold: 0.5,
    profile: "basic",
    effectiveProfile: "basic",
    model: "openai/gpt-5.6-luna#low",
    confidence: 0.49,
    decisionReason: "low-risk classification fell back to basic",
    policyVersion: "2026-09-27-v4",
  })
})

test("routes at the default confidence threshold boundary", async () => {
  let switched = false
  await routePrompt({ sessionID: "boundary", text: "Do something", metadata: {} }, dependencies({
    classify: async () => ({ ...lunaRoute, confidence: 0.5 }),
    switchModel: async () => { switched = true },
  }))
  assert.equal(switched, true)
})

for (const agent of ["auto", "plan"]) {
  test(`${agent} routes at the confidence threshold`, async () => {
    let switched = false
    await routePrompt({ sessionID: agent, text: "Work", metadata: {} }, dependencies({
      session: { agent },
      routingAgents: new Set(["auto", "plan"]),
      classify: async () => ({ ...lunaRoute, confidence: 0.5 }),
      switchModel: async () => { switched = true },
    }))
    assert.equal(switched, true)
  })
}

for (const agent of ["build"]) {
  test(`${agent} bypasses routing without classifying, switching, or marking`, async () => {
    let classified = false
    let switched = false
    let marked = false
    await routePrompt({ sessionID: agent, text: "Work", metadata: {} }, dependencies({
      session: { agent },
      routingAgents: new Set(["auto", "plan"]),
      classify: async () => { classified = true; return lunaRoute },
      switchModel: async () => { switched = true },
      markRouted: async () => { marked = true },
    }))
    assert.deepEqual({ classified, switched, marked }, { classified: false, switched: false, marked: false })
  })
}

test("a bypassed native session starts reevaluating after switching to Auto", async () => {
  let agent = "build"
  let marked = false
  let classified = 0
  const deps = dependencies({
    getSession: async () => ({ agent }),
    routingAgents: new Set(["auto"]),
    wasRouted: async () => marked,
    markRouted: async () => { marked = true },
    classify: async () => { classified += 1; return lunaRoute },
  })
  await routePrompt({ sessionID: "switchable", text: "Manual", metadata: {} }, deps)
  agent = "auto"
  await routePrompt({ sessionID: "switchable", text: "Auto", metadata: {} }, deps)
  await routePrompt({ sessionID: "switchable", text: "Later", metadata: {} }, deps)
  assert.equal(classified, 2)
})

test("an Auto child session is bypassed before classification or switching", async () => {
  let classified = false
  let switched = false
  await routePrompt({ sessionID: "auto-child", text: "Work", metadata: {} }, dependencies({
    session: { agent: "auto", parentID: "root" },
    routingAgents: new Set(["auto"]),
    classify: async () => { classified = true; return lunaRoute },
    switchModel: async () => { switched = true },
  }))
  assert.deepEqual({ classified, switched }, { classified: false, switched: false })
})

test("omitting routingAgents preserves route-all-primary behavior", async () => {
  let classified = false
  await routePrompt({ sessionID: "other", text: "Work", metadata: {} }, dependencies({
    session: { agent: "other-primary" },
    classify: async () => { classified = true; return lunaRoute },
  }))
  assert.equal(classified, true)
})

test("normalizes configured routing agents and ignores invalid or blank entries", () => {
  assert.deepEqual([...normalizeRoutingAgents([" plan ", "", 42, "auto", "plan", null])!], [
    "plan",
    "auto",
  ])
  assert.equal(normalizeRoutingAgents(undefined), undefined)
  assert.deepEqual([...normalizeRoutingAgents("auto")!], [])
})

test("bare plan command does not consume first-prompt routing", () => {
  assert.equal(isSubstantiveRoutingPrompt("Plan . Do not implement. If no task was provided, ask for the task.", "plan"), false)
  assert.equal(isSubstantiveRoutingPrompt("Plan a cache migration. Do not implement. If no task was provided, ask for the task.", "plan"), true)
  assert.equal(isSubstantiveRoutingPrompt("Plan . Do not implement. If no task was provided, ask for the task.", "auto"), true)
})

test("the prompt hook skips health and classification for native agents", async () => {
  const originalFetch = globalThis.fetch
  let fetches = 0
  let promptHook: ((event: { sessionID: string; prompt: { text: string }; metadata?: Record<string, unknown> }) => Promise<void>) | undefined
  let contextHookRegistered = false
  let agent = "build"
  const storage = new Map<string, unknown>()
  globalThis.fetch = async () => {
    fetches += 1
    return new Response(JSON.stringify({
      answers: { model_profile: { choice: "basic", confidence: 0.9 } },
    }), { status: 200, headers: { "content-type": "application/json" } })
  }
  try {
    await router.setup({
      options: { autoStart: false, routingAgents: ["auto"] },
      storage: { get: async (key: string) => storage.get(key), set: async (key: string, value: unknown) => { storage.set(key, value) } },
      session: {
        get: async () => ({ agent }),
        switchModel: async () => {},
        hook: async (name: string, callback: never) => {
          if (name === "prompt") promptHook = callback
          if (name === "context") contextHookRegistered = true
        },
      },
      rpc: { register: async () => {} },
    } as never)
    fetches = 0 // Ignore the optional eager setup health check.
    await promptHook?.({ sessionID: "same-session", prompt: { text: "Manual" } })
    assert.equal(fetches, 0)
    assert.equal(storage.get("model-route/same-session"), undefined)

    agent = "auto"
    await promptHook?.({ sessionID: "same-session", prompt: { text: "Auto" } })
    assert.equal(fetches > 0, true)
    assert.deepEqual(storage.get("model-route/same-session"), {
      status: "routed",
      effectiveProfile: "basic",
      policyVersion: "2026-09-27-v4",
      timestamp: (storage.get("model-route/same-session") as { timestamp: string }).timestamp,
    })

    assert.equal(contextHookRegistered, false)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("attachment prompts can use a low profile when the task is low complexity", async () => {
  let selected = ""
  await routePrompt({ sessionID: "attachment", text: "Summarize this", metadata: {}, hasAttachments: true }, dependencies({
    classify: async () => ({ ...lunaRoute, profile: "micro", choiceProbability: 0.9, margin: 0.8 }),
    switchModel: async (_sessionID, model) => { selected = `${model.id}#${model.variant}` },
  }))
  assert.equal(selected, "ministral-3:8b#undefined")
})

test("classification failure switches to fallback and marks the decision", async () => {
  let switched = false
  let marked = false
  let recorded: unknown

  await routePrompt(
      { sessionID: "root", text: "Do something", metadata: {} },
      dependencies({
        classify: async () => {
          throw new Error("Laya unavailable")
        },
        recordLaya: async (_sessionID, result) => { recorded = result },
        switchModel: async () => {
          switched = true
        },
        markRouted: async () => {
          marked = true
        },
      }),
    )

  assert.equal(switched, true)
  assert.equal(marked, true)
  assert.deepEqual(recorded, {
    status: "fallback",
    threshold: 0.5,
    effectiveProfile: "standard",
    model: "openai/gpt-6-luna#medium",
    fallbackReason: "Classification failed",
    error: "Error: Laya unavailable",
  })
})

test("fallback switch failure remains unmarked and throws classification error", async () => {
  let marked = false
  await assert.rejects(() => routePrompt(
    { sessionID: "fallback-failure", text: "Work", metadata: {} },
    dependencies({
      classify: async () => { throw new Error("classifier failed") },
      switchModel: async () => { throw new Error("switch failed") },
      markRouted: async () => { marked = true },
    }),
  ), /classifier failed/)
  assert.equal(marked, false)
})

test("records confidence separately from choice probability and margin", async () => {
  let recorded: unknown
  await routePrompt({ sessionID: "scores", text: "Work", metadata: {} }, dependencies({
    classify: async () => ({ ...lunaRoute, confidence: 0.8, choiceProbability: 0.6, margin: 0.3, probabilities: { basic: 0.6, standard: 0.3 } }),
    recordLaya: async (_sessionID, value) => { recorded = value },
  }))
  assert.deepEqual(recorded, {
    status: "routed", profile: "basic", effectiveProfile: "basic", model: "openai/gpt-5.6-luna#low",
    confidence: 0.8, choiceProbability: 0.6, margin: 0.3, threshold: 0.5,
    probabilities: { basic: 0.6, standard: 0.3 },
    decisionReason: "basic classification passed policy gates", policyVersion: "2026-09-27-v4",
  })
})

test("invalid scores route to fallback", async () => {
  let selected = ""
  await routePrompt({ sessionID: "invalid-score", text: "Work", metadata: {} }, dependencies({
    classify: async () => ({ ...lunaRoute, confidence: Number.NaN }),
    switchModel: async (_sessionID, model) => { selected = model.id },
  }))
  assert.equal(selected, "gpt-6-luna")
})

test("readiness success classifies while readiness timeout falls back", async () => {
  let classifications = 0
  let selected = ""
  await routePrompt({ sessionID: "ready", text: "Work", metadata: {} }, dependencies({
    ensureReady: async () => true,
    classify: async () => { classifications += 1; return lunaRoute },
  }))
  await routePrompt({ sessionID: "timeout", text: "Work", metadata: {} }, dependencies({
    ensureReady: async () => false,
    classify: async () => { classifications += 1; return lunaRoute },
    switchModel: async (_sessionID, model) => { selected = model.id },
  }))
  assert.equal(classifications, 1)
  assert.equal(selected, "gpt-6-luna")
})

test("validates router profiles, fallback, thresholds, and timeouts", () => {
  assert.doesNotThrow(() => validateRouterOptions({}))
  assert.throws(() => validateRouterOptions({ profiles: {} }), /routing profiles must be exactly/)
  assert.throws(() => validateRouterOptions({ profiles: {}, profilesFile: "profiles.json" }), /either profiles or profilesFile/)
  assert.throws(() => validateRouterOptions({ profilesFile: "" }), /non-empty path/)
  assert.throws(() => validateRouterOptions({ fallbackProfile: "missing" }), /does not exist/)
  assert.throws(() => validateRouterOptions({ healthTimeoutMs: 0 }), /finite and positive/)
  assert.throws(() => validateRouterOptions({ startupTimeoutMs: Number.NaN }), /finite and positive/)
})

test("builds a read-only JSON report for only the requested session", async () => {
  const storage = new Map<string, unknown>()
  const root = {
    agent: "build",
    model: { providerID: "openai", id: "gpt-6-luna", variant: "medium" },
  }
  storage.set("telemetry/children/root", ["child-one"])
  storage.set("telemetry/session/root", {
    laya: { status: "routed", profile: "standard", confidence: 0.87, threshold: 0.5 },
    usage: [],
  })
  const requested: string[] = []

  const reportText = await buildTelemetryReport({
    storage: { get: async (key: string) => storage.get(key), set: async () => {} },
    session: { get: async ({ sessionID }: { sessionID: string }) => { requested.push(sessionID); return root } },
  } as never, "root", "json")

  const report = JSON.parse(reportText) as {
    session: { id: string; agent: string }
    children?: unknown
  }
  assert.equal(report.session.id, "root")
  assert.equal(report.session.agent, "build")
  assert.equal(report.children, undefined)
  assert.deepEqual(requested, ["root"])
})

test("reports unknown agent and model when the session has no selection", async () => {
  const reportText = await buildTelemetryReport({
    storage: { get: async () => undefined, set: async () => {} },
    session: { get: async () => ({}) },
  } as never, "session-without-selection", "json")
  const report = JSON.parse(reportText) as {
    session: { agent: string; model: { providerID: string; modelID: string } }
  }

  assert.equal(report.session.agent, "unknown")
  assert.deepEqual(report.session.model, { providerID: "unknown", modelID: "unknown" })
})
