import { spawn, type ChildProcess } from "node:child_process"
import {
  aggregateModelUsage,
  formatTelemetryJson,
  formatTelemetryMarkdown,
  type LayaTelemetry,
  type ModelUsageEvent,
  type NativeSessionInfo,
  type SessionTelemetry,
  type TelemetryModel,
} from "./telemetry.ts"
import type { TelemetryFormat } from "./telemetry-rpc.ts"
import { evaluateRoutingPolicy } from "./routing-policy.ts"
import { loadProfilesFile, validateProfiles, type RoutingProfile } from "./profile-config.ts"

type JsonObject = Record<string, unknown>

type ModelReference = {
  providerID: string
  id: string
  variant?: string
}

type ModelProfile = RoutingProfile

export type RouterOptions = {
  endpoint?: string
  healthURL?: string
  modelConfidenceThreshold?: number
  minimumChoiceProbability?: number
  minimumMargin?: number
  minimumMicroChoiceProbability?: number
  minimumMicroMargin?: number
  profilePolicyVersion?: string
  timeoutMs?: number
  autoStart?: boolean
  command?: string[]
  environment?: Record<string, string>
  profiles?: Record<string, ModelProfile>
  profilesFile?: string
  routingAgents?: string[]
  fallbackProfile?: string
  healthTimeoutMs?: number
  startupTimeoutMs?: number
}

type ChoiceAnswer = {
  choice?: string
  confidence?: number
  probabilities?: Record<string, number>
}

type LayaResponse = {
  answers?: { model_profile?: ChoiceAnswer }
  routing?: JsonObject
}

export type ModelRoute = {
  profile: string
  model: ModelReference
  confidence: number
  probabilities?: Record<string, number>
  choiceProbability?: number
  margin?: number
  layaRouting?: JsonObject
}

export type RoutingCompletion = {
  status: "routed" | "fallback"
  effectiveProfile: string
  policyVersion: string
  timestamp: string
}

export type RoutePromptDependencies = {
  getSession(sessionID: string): Promise<{ parentID?: string; agent?: string }>
  wasRouted(sessionID: string): Promise<boolean>
  getRoutingCompletion?(sessionID: string): Promise<RoutingCompletion | undefined>
  markRouted(sessionID: string, completion: RoutingCompletion): Promise<void>
  classify(text: string): Promise<ModelRoute | undefined>
  switchModel(sessionID: string, model: ModelReference): Promise<void>
  recordLaya?(sessionID: string, result: LayaTelemetry): Promise<void>
  confidenceThreshold?: number
  routingAgents?: ReadonlySet<string>
  session?: { parentID?: string; agent?: string }
  fallbackProfile?: string
  fallbackModel?: ModelReference
  ensureReady?: () => Promise<boolean>
  profiles?: Record<string, ModelProfile>
  minimumChoiceProbability?: number
  minimumMargin?: number
  minimumMicroChoiceProbability?: number
  minimumMicroMargin?: number
  policyVersion?: string
}

type RoutePromptEvent = {
  sessionID: string
  text: string
  metadata: Record<string, unknown>
  hasAttachments?: boolean
}

type SharedServer = {
  child?: ChildProcess
  starting?: boolean
}

type PromptHookEvent = {
  readonly sessionID: string
  prompt: { text: string; files?: readonly unknown[] }
  metadata?: Record<string, unknown>
}

type SessionModelRequestEvent = {
  readonly sessionID: string
  readonly agent: string
  readonly model: ModelReference
  readonly kind: "primary" | "title" | "compaction" | "generate"
}

type SessionSnapshot = {
  parentID?: string
  agent?: string
  model?: ModelReference | { providerID: string; modelID: string; variant?: string }
  outcome?: string
}

type PluginContext = {
  options: unknown
  storage: {
    get(key: string): Promise<unknown>
    set(key: string, value: unknown): Promise<void>
  }
  session: {
    get(input: { sessionID: string }): Promise<SessionSnapshot>
    switchModel(input: { sessionID: string; model: ModelReference }): Promise<void>
    hook(name: "prompt", callback: (event: PromptHookEvent) => void | Promise<void>): Promise<unknown>
    hook(
      name: "model.request",
      callback: (event: SessionModelRequestEvent) => void | Promise<void>,
    ): Promise<unknown>
  }
  rpc: {
    register(
      definition: unknown,
      handlers: {
        get(input: { sessionID: string; format: TelemetryFormat }): Promise<{ report: string }>
      },
    ): Promise<unknown>
  }
}

export const defaultProfiles: Record<string, ModelProfile> = {
    micro: {
    model: { providerID: "ollama", id: "ministral-3:8b" },
    criteria:
      "bounded low-complexity tool use or response requiring negligible reasoning: phatic interaction, acknowledgement, reading or writing a simple file, a straightforward web lookup, or mechanical transformation of fully supplied content",
  },
  basic: {
    model: { providerID: "openai", id: "gpt-5.6-luna", variant: "low" },
    criteria:
      "simple low-risk task requiring light reasoning, including reading or writing files, repository discovery, straightforward web search, concise factual answers, explanations, summaries, or drafting from supplied context",
  },
  standard: {
    model: { providerID: "openai", id: "gpt-6-luna", variant: "medium" },
    criteria:
      "routine code implementation or engineering work requiring generated or modified code, tests, debugging, refactoring, or commands beyond straightforward file and web tool use",
  },
  advanced: {
    model: { providerID: "openai", id: "gpt-6-sol", variant: "low" },
    criteria:
      "planning, cross-file or multi-component reasoning, difficult implementation, nontrivial debugging, integration decisions, significant reviews, or comparison of multiple approaches within an established architecture",
  },
  deep: {
    model: { providerID: "openai", id: "gpt-6-sol", variant: "high" },
    criteria:
      "consequential or highly uncertain reasoning involving architecture, security, privacy, compliance, migration, production, destructive operations, distributed systems, broad high-impact changes, or ambiguous root-cause diagnosis",
  },
}

const sharedKey = Symbol.for("opencode.laya-model-router.server")
const globalState = globalThis as typeof globalThis & { [sharedKey]?: SharedServer }
const shared = (globalState[sharedKey] ??= {})
const routingLocks = new Map<string, Promise<void>>()

const barePlanPrompt = /^Plan\s*\.\s*Do not implement\.\s*If no task was provided, ask for the task\.\s*$/i

export const isSubstantiveRoutingPrompt = (text: string, agent?: string): boolean => {
  const normalized = text.trim()
  if (!normalized) return false
  return agent !== "plan" || !barePlanPrompt.test(normalized)
}

export const normalizeRoutingAgents = (value: unknown): ReadonlySet<string> | undefined => {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) return new Set()
  return new Set(value.flatMap((entry) =>
    typeof entry === "string" && entry.trim() ? [entry.trim()] : []))
}

const positiveFinite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0

const validScore = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1

export const validateRouterOptions = (value: unknown): RouterOptions => {
  if (!value || typeof value !== "object") throw new Error("Invalid laya-router configuration: options must be an object")
  const options = value as RouterOptions
  if (options.profiles !== undefined && options.profilesFile !== undefined) {
    throw new Error("Invalid laya-router configuration: configure either profiles or profilesFile, not both")
  }
  if (options.profilesFile !== undefined && (typeof options.profilesFile !== "string" || !options.profilesFile.trim())) {
    throw new Error("Invalid laya-router configuration: profilesFile must be a non-empty path")
  }
  const profiles = options.profilesFile
    ? loadProfilesFile(options.profilesFile)
    : options.profiles === undefined ? defaultProfiles : validateProfiles(options.profiles)
  const fallbackProfile = options.fallbackProfile === undefined ? "standard" : options.fallbackProfile
  if (typeof fallbackProfile !== "string" || !fallbackProfile.trim() || !Object.hasOwn(profiles, fallbackProfile)) {
    throw new Error(`Invalid laya-router configuration: fallback profile '${fallbackProfile}' does not exist`)
  }
  for (const [name, timeout] of [["timeoutMs", options.timeoutMs ?? 2_000], ["healthTimeoutMs", options.healthTimeoutMs ?? 500], ["startupTimeoutMs", options.startupTimeoutMs ?? 5_000]] as const) {
    if (!positiveFinite(timeout)) throw new Error(`Invalid laya-router configuration: ${name} must be finite and positive`)
  }
  if (options.modelConfidenceThreshold !== undefined && !validScore(options.modelConfidenceThreshold)) {
    throw new Error("Invalid laya-router configuration: modelConfidenceThreshold must be finite and between 0 and 1")
  }
  for (const name of ["minimumChoiceProbability", "minimumMargin", "minimumMicroChoiceProbability", "minimumMicroMargin"] as const) {
    if (options[name] !== undefined && !validScore(options[name])) throw new Error(`Invalid laya-router configuration: ${name} must be finite and between 0 and 1`)
  }
  if (options.profilePolicyVersion !== undefined && (typeof options.profilePolicyVersion !== "string" || !options.profilePolicyVersion.trim())) throw new Error("Invalid laya-router configuration: profilePolicyVersion must be non-empty")
  return { ...options, profiles, fallbackProfile }
}

const fetchWithTimeout = async (url: string, init: RequestInit, timeoutMs: number): Promise<Response> => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

const isHealthy = async (healthURL: string, timeoutMs: number): Promise<boolean> => {
  try {
    const response = await fetchWithTimeout(healthURL, { method: "GET" }, timeoutMs)
    return response.ok
  } catch {
    return false
  }
}

const startServer = (options: RouterOptions): void => {
  if (!options.autoStart || shared.starting || shared.child || !options.command?.length) return

  shared.starting = true
  const [executable, ...args] = options.command
  const child = spawn(executable, args, {
    env: { ...process.env, ...options.environment },
    stdio: "ignore",
  })
  shared.child = child
  child.unref()
  child.once("exit", () => {
    if (shared.child === child) shared.child = undefined
    shared.starting = false
  })
  child.once("spawn", () => {
    shared.starting = false
  })
  child.once("error", () => {
    if (shared.child === child) shared.child = undefined
    shared.starting = false
  })
}

const ensureServerReady = async (options: RouterOptions): Promise<boolean> => {
  const healthURL = options.healthURL ?? "http://127.0.0.1:8765/health"
  const healthTimeoutMs = options.healthTimeoutMs ?? 500
  if (await isHealthy(healthURL, healthTimeoutMs)) return true
  startServer(options)
  const deadline = Date.now() + (options.startupTimeoutMs ?? 5_000)
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, Math.min(100, Math.max(1, deadline - Date.now()))))
    if (await isHealthy(healthURL, healthTimeoutMs)) return true
  }
  return false
}

export const classifyPrompt = async (text: string, options: RouterOptions): Promise<ModelRoute | undefined> => {
  const profiles = options.profiles ?? defaultProfiles
  const criteria = Object.fromEntries(Object.entries(profiles).map(([profile, value]) => [profile, value.criteria]))
  const endpoint = options.endpoint ?? "http://127.0.0.1:8765/v1/systemone"
  const timeoutMs = options.timeoutMs ?? 2_000
  const response = await fetchWithTimeout(
    endpoint,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        state: { request: text },
        questions: {
          model_profile: {
            type: "choice",
            instructions: "Select the least expensive profile that can safely complete `request`. First determine whether tools, files, repository access, current external facts, code generation, or side effects are required; then assess reasoning complexity, consequence, and uncertainty. Micro is only for a response containing no substantive new information or for mechanical supplied-content transformation. Any answer, explanation, summary, or substantive draft is at least basic. Use standard for routine grounded implementation with a settled design, advanced for planning or difficult multi-component reasoning, and deep for consequential, highly ambiguous, architectural, or sustained grilling work. Classify the requested task, not isolated keywords or quoted content.",
            criteria,
          },
        },
      }),
    },
    timeoutMs,
  )
  if (!response.ok) throw new Error(`Laya returned HTTP ${response.status}`)

  const result = (await response.json()) as LayaResponse
  const answer = result.answers?.model_profile
  const profile = answer?.choice
  if (!profile || !Object.hasOwn(profiles, profile)) throw new Error(`Laya returned unknown model profile '${profile ?? "missing"}'`)
  if (!validScore(answer?.confidence)) throw new Error("Laya returned invalid confidence")
  let choiceProbability: number | undefined
  let margin: number | undefined
  if (answer.probabilities !== undefined) {
    const values = Object.values(answer.probabilities)
    if (!values.length || values.some((value) => !validScore(value)) || !validScore(answer.probabilities[profile])) {
      throw new Error("Laya returned malformed probabilities")
    }
    choiceProbability = answer.probabilities[profile]
    const sorted = [...values].sort((a, b) => b - a)
    margin = sorted[0]! - (sorted[1] ?? 0)
  }

  return {
    profile,
    model: profiles[profile].model,
    confidence: answer.confidence,
    ...(choiceProbability === undefined ? {} : { choiceProbability, margin }),
    ...(answer?.probabilities ? { probabilities: answer.probabilities } : {}),
    layaRouting: result.routing,
  }
}

const modelName = (model: ModelReference): string =>
  `${model.providerID}/${model.id}${model.variant ? `#${model.variant}` : ""}`

const decisionFields = (route: ModelRoute): Partial<LayaTelemetry> => ({
  profile: route.profile,
  confidence: route.confidence,
  ...(route.choiceProbability === undefined ? {} : { choiceProbability: route.choiceProbability }),
  ...(route.margin === undefined ? {} : { margin: route.margin }),
  ...(route.probabilities ? { probabilities: route.probabilities } : {}),
})

const switchToFallback = async (
  event: RoutePromptEvent,
  dependencies: RoutePromptDependencies,
  threshold: number,
  reason: string,
  route?: ModelRoute,
  classificationError?: unknown,
): Promise<void> => {
  const fallbackProfile = dependencies.fallbackProfile ?? "standard"
  const fallbackModel = dependencies.fallbackModel ?? defaultProfiles.standard!.model
  try {
    await dependencies.switchModel(event.sessionID, fallbackModel)
  } catch (switchError) {
    const error = classificationError ?? switchError
    try {
      await dependencies.recordLaya?.(event.sessionID, {
        status: "classification-error", threshold, error: String(error), fallbackReason: reason,
        ...(route ? decisionFields(route) : {}),
      })
    } catch { /* Preserve the routing failure. */ }
    throw error
  }
  await dependencies.markRouted(event.sessionID, {
    status: "fallback",
    effectiveProfile: fallbackProfile,
    policyVersion: dependencies.policyVersion ?? "2026-09-27-v4",
    timestamp: new Date().toISOString(),
  })
  const telemetry: LayaTelemetry = {
    status: "fallback", threshold, effectiveProfile: fallbackProfile,
    model: modelName(fallbackModel), fallbackReason: reason,
    ...(classificationError === undefined ? {} : { error: String(classificationError) }),
    ...(route ? decisionFields(route) : {}),
  }
  event.metadata.laya = {
    selectedProfile: route?.profile,
    effectiveProfile: fallbackProfile,
    model: telemetry.model,
    ...(route ? decisionFields(route) : {}),
    fallbackReason: reason,
  }
  await dependencies.recordLaya?.(event.sessionID, telemetry)
}

const routePromptUnlocked = async (
  event: RoutePromptEvent,
  dependencies: RoutePromptDependencies,
): Promise<void> => {
  const session = dependencies.session ?? await dependencies.getSession(event.sessionID)
  if (session.parentID) {
    await dependencies.recordLaya?.(event.sessionID, { status: "child-bypassed", threshold: dependencies.confidenceThreshold ?? 0.5 })
    return
  }
  if (dependencies.routingAgents && !dependencies.routingAgents.has(session.agent ?? "")) return
  if (session.agent !== "auto" && await dependencies.wasRouted(event.sessionID)) {
    const completion = await dependencies.getRoutingCompletion?.(event.sessionID)
    if (session.agent !== "plan" || !completion || completion.effectiveProfile === "advanced" || completion.effectiveProfile === "deep") return
  }

  const threshold = dependencies.confidenceThreshold ?? 0.5
  if (dependencies.ensureReady && !(await dependencies.ensureReady())) {
    await switchToFallback(event, dependencies, threshold, "Laya readiness timed out")
    return
  }
  let route: ModelRoute | undefined
  try {
    route = await dependencies.classify(event.text)
  } catch (error) {
    await switchToFallback(event, dependencies, threshold, "Classification failed", undefined, error)
    return
  }

  if (!route) {
    await switchToFallback(event, dependencies, threshold, "Laya returned no valid model profile")
    return
  }

  if (!validScore(route.confidence) || (route.choiceProbability !== undefined && !validScore(route.choiceProbability)) ||
    (route.margin !== undefined && !validScore(route.margin)) ||
    (route.probabilities && Object.values(route.probabilities).some((value) => !validScore(value)))) {
    await switchToFallback(event, dependencies, threshold, "Laya returned invalid scores", route)
    return
  }

  const policy = evaluateRoutingPolicy(event.text, route, {
    profiles: dependencies.profiles ?? defaultProfiles,
    confidenceThreshold: threshold,
    minimumChoiceProbability: dependencies.minimumChoiceProbability ?? 0.45,
    minimumMargin: dependencies.minimumMargin ?? 0.10,
    minimumMicroChoiceProbability: dependencies.minimumMicroChoiceProbability ?? 0.35,
    minimumMicroMargin: dependencies.minimumMicroMargin ?? 0.05,
    policyVersion: dependencies.policyVersion ?? "2026-09-27-v4",
  }, { hasAttachments: event.hasAttachments, agent: session.agent })

  try {
    await dependencies.switchModel(event.sessionID, policy.model)
  } catch (error) {
    await dependencies.recordLaya?.(event.sessionID, {
      status: "classification-error",
      threshold,
      error: String(error),
    })
    throw error
  }
  await dependencies.markRouted(event.sessionID, {
    status: "routed",
    effectiveProfile: policy.effectiveProfile,
    policyVersion: policy.policyVersion,
    timestamp: new Date().toISOString(),
  })
  await dependencies.recordLaya?.(event.sessionID, {
    status: "routed",
    profile: route.profile,
    model: modelName(policy.model),
    confidence: route.confidence,
    threshold,
    ...(route.probabilities ? { probabilities: route.probabilities } : {}),
    ...(route.choiceProbability === undefined ? {} : { choiceProbability: route.choiceProbability }),
    ...(route.margin === undefined ? {} : { margin: route.margin }),
    effectiveProfile: policy.effectiveProfile,
    ...(policy.minimumProfile ? { minimumProfile: policy.minimumProfile } : {}),
    decisionReason: policy.decisionReason,
    policyVersion: policy.policyVersion,
  })
  event.metadata.laya = {
    selectedProfile: route.profile,
    profile: route.profile,
    effectiveProfile: policy.effectiveProfile,
    model: modelName(policy.model),
    ...(policy.minimumProfile ? { minimumProfile: policy.minimumProfile } : {}),
    decisionReason: policy.decisionReason,
    policyVersion: policy.policyVersion,
    confidence: route.confidence,
    ...(route.choiceProbability === undefined ? {} : { choiceProbability: route.choiceProbability }),
    ...(route.margin === undefined ? {} : { margin: route.margin }),
    ...(route.layaRouting ? { routing: route.layaRouting } : {}),
  }
}

export const routePrompt = async (
  event: RoutePromptEvent,
  dependencies: RoutePromptDependencies,
): Promise<void> => {
  const previous = routingLocks.get(event.sessionID) ?? Promise.resolve()
  let release = (): void => {}
  const current = new Promise<void>((resolve) => { release = resolve })
  routingLocks.set(event.sessionID, current)
  await previous
  try {
    await routePromptUnlocked(event, dependencies)
  } finally {
    release()
    if (routingLocks.get(event.sessionID) === current) routingLocks.delete(event.sessionID)
  }
}

const telemetryKey = (sessionID: string): string => `telemetry/session/${sessionID}`
const storageWrites = new Map<string, Promise<void>>()

const updateStoredValue = async (
  ctx: PluginContext,
  key: string,
  update: (existing: unknown) => unknown,
): Promise<void> => {
  const previous = storageWrites.get(key) ?? Promise.resolve()
  let release = (): void => {}
  const current = new Promise<void>((resolve) => { release = resolve })
  storageWrites.set(key, current)
  await previous
  try {
    await ctx.storage.set(key, update(await ctx.storage.get(key)))
  } finally {
    release()
    if (storageWrites.get(key) === current) storageWrites.delete(key)
  }
}

const readTelemetry = async (ctx: PluginContext, sessionID: string): Promise<SessionTelemetry | undefined> => {
  const value = await ctx.storage.get(telemetryKey(sessionID))
  if (!value || typeof value !== "object") return undefined
  const telemetry = value as SessionTelemetry
  if (
    telemetry.laya?.status === "classification-error" &&
    telemetry.laya.error === "No Laya decision recorded"
  ) {
    return {
      ...telemetry,
      laya: { status: "not-evaluated", threshold: telemetry.laya.threshold },
    }
  }
  return telemetry
}

const modelForTelemetry = (
  model?: ModelReference | { providerID: string; modelID: string; variant?: string },
): TelemetryModel => ({
  providerID: model?.providerID ?? "unknown",
  modelID: model && "modelID" in model ? model.modelID : model?.id ?? "unknown",
  ...(model?.variant ? { variant: model.variant } : {}),
})

const persistLaya = async (ctx: PluginContext, sessionID: string, laya: LayaTelemetry): Promise<void> => {
  await updateStoredValue(ctx, telemetryKey(sessionID), (value) => {
    const existing = value && typeof value === "object" ? value as SessionTelemetry : undefined
    return { laya, usage: existing?.usage ?? [] } satisfies SessionTelemetry
  })
}

const recordUsage = async (ctx: PluginContext, event: SessionModelRequestEvent): Promise<void> => {
  const usageEvent: ModelUsageEvent = {
    agent: event.agent,
    ...modelForTelemetry(event.model),
    kind: event.kind,
    timestamp: new Date().toISOString(),
  }
  await updateStoredValue(ctx, telemetryKey(event.sessionID), (value) => {
    const existing = value && typeof value === "object" ? value as SessionTelemetry : undefined
    return {
      laya: existing?.laya ?? { status: "not-evaluated", threshold: 0.5 },
      usage: mergeUsage(existing?.usage ?? [], usageEvent),
    } satisfies SessionTelemetry
  })
}

const mergeUsage = (
  current: SessionTelemetry["usage"],
  event: ModelUsageEvent,
): SessionTelemetry["usage"] => {
  const next = aggregateModelUsage([event])[0]
  if (!next) return current
  const index = current.findIndex((entry) =>
    entry.agent === next.agent && entry.providerID === next.providerID && entry.modelID === next.modelID &&
    entry.variant === next.variant && entry.kind === next.kind)
  if (index < 0) return [...current, next]
  return current.map((entry, i) => i === index ? {
    ...entry,
    requests: entry.requests + 1,
    firstTimestamp: entry.firstTimestamp < event.timestamp ? entry.firstTimestamp : event.timestamp,
    lastTimestamp: entry.lastTimestamp > event.timestamp ? entry.lastTimestamp : event.timestamp,
  } : entry)
}

export const buildTelemetryReport = async (
  ctx: PluginContext,
  sessionID: string,
  format: TelemetryFormat,
): Promise<string> => {
  const native = await ctx.session.get({ sessionID })
  const session: NativeSessionInfo = {
    id: sessionID,
    agent: native.agent ?? "unknown",
    model: modelForTelemetry(native.model),
  }
  const telemetry = await readTelemetry(ctx, sessionID)
  return format === "json"
    ? formatTelemetryJson(session, telemetry)
    : formatTelemetryMarkdown(session, telemetry)
}

export default {
  id: "laya-model-router",
  async setup(ctx: PluginContext) {
    const options = validateRouterOptions(ctx.options)
    const routingAgents = normalizeRoutingAgents(options.routingAgents)
    const healthURL = options.healthURL ?? "http://127.0.0.1:8765/health"
    const healthTimeoutMs = options.healthTimeoutMs ?? 500
    const profiles = options.profiles!
    const fallbackProfile = options.fallbackProfile!
    const fallbackModel = profiles[fallbackProfile]!.model
    const routedKey = (sessionID: string): string => `model-route/${sessionID}`
    const legacyRoutedKey = (sessionID: string): string => `model-routed/${sessionID}`
    const readCompletion = async (sessionID: string): Promise<RoutingCompletion | undefined> => {
      const value = await ctx.storage.get(routedKey(sessionID))
      if (!value || typeof value !== "object") return undefined
      const completion = value as Partial<RoutingCompletion>
      if ((completion.status !== "routed" && completion.status !== "fallback") ||
        typeof completion.effectiveProfile !== "string" || typeof completion.policyVersion !== "string" ||
        typeof completion.timestamp !== "string") return undefined
      return completion as RoutingCompletion
    }
    const wasRouted = async (sessionID: string): Promise<boolean> =>
      Boolean(await readCompletion(sessionID)) || (await ctx.storage.get(legacyRoutedKey(sessionID))) === true
    const markRouted = async (sessionID: string, completion: RoutingCompletion): Promise<void> =>
      ctx.storage.set(routedKey(sessionID), completion)
    let lastWarningAt = 0

    if (!(await isHealthy(healthURL, healthTimeoutMs))) startServer(options)

    const { SessionTelemetryRpc } = await import("./telemetry-rpc.ts")
    await ctx.rpc.register(SessionTelemetryRpc, {
      get: async ({ sessionID, format }) => ({ report: await buildTelemetryReport(ctx, sessionID, format) }),
    })

    await ctx.session.hook("model.request", async (event: SessionModelRequestEvent) => {
      await recordUsage(ctx, event)
    })

    await ctx.session.hook("prompt", async (event: PromptHookEvent) => {
      const text = event.prompt.text.trim()
      event.metadata ??= {}

      try {
        const session = await ctx.session.get({ sessionID: event.sessionID })
        if (!isSubstantiveRoutingPrompt(text, session.agent)) return
        if (session.parentID) {
          await routePrompt(
            { sessionID: event.sessionID, text, metadata: event.metadata, hasAttachments: Boolean(event.prompt.files?.length) },
            {
              session,
              getSession: async () => session,
              wasRouted,
              getRoutingCompletion: readCompletion,
              markRouted,
              classify: async (prompt) => classifyPrompt(prompt, options),
              switchModel: async (sessionID, model) => ctx.session.switchModel({ sessionID, model }),
              recordLaya: async (sessionID, result) => persistLaya(ctx, sessionID, result),
              confidenceThreshold: options.modelConfidenceThreshold,
              routingAgents,
              fallbackProfile,
              fallbackModel,
              profiles,
              minimumChoiceProbability: options.minimumChoiceProbability,
              minimumMargin: options.minimumMargin,
              minimumMicroChoiceProbability: options.minimumMicroChoiceProbability,
              minimumMicroMargin: options.minimumMicroMargin,
              policyVersion: options.profilePolicyVersion,
            },
          )
          return
        }
        if (routingAgents && !routingAgents.has(session.agent ?? "")) return
        await routePrompt(
          { sessionID: event.sessionID, text, metadata: event.metadata, hasAttachments: Boolean(event.prompt.files?.length) },
          {
            getSession: async (sessionID) => {
              const session = await ctx.session.get({ sessionID })
              return session
            },
            wasRouted,
            getRoutingCompletion: readCompletion,
            markRouted,
            classify: async (prompt) => classifyPrompt(prompt, options),
            switchModel: async (sessionID, model) => ctx.session.switchModel({ sessionID, model }),
            recordLaya: async (sessionID, result) => persistLaya(ctx, sessionID, result),
            confidenceThreshold: options.modelConfidenceThreshold,
            routingAgents,
            session,
            fallbackProfile,
            fallbackModel,
            profiles,
            minimumChoiceProbability: options.minimumChoiceProbability,
            minimumMargin: options.minimumMargin,
            minimumMicroChoiceProbability: options.minimumMicroChoiceProbability,
            minimumMicroMargin: options.minimumMicroMargin,
            policyVersion: options.profilePolicyVersion,
            ensureReady: async () => ensureServerReady(options),
          },
        )
      } catch (error) {
        const now = Date.now()
        if (now - lastWarningAt <= 60_000) return
        console.warn(`[laya-model-router] Routing failed before a durable decision; the next prompt may retry: ${String(error)}`)
        lastWarningAt = now
      }
    })
  },
}
