export type LayaStatus = "routed" | "fallback" | "below-threshold" | "classification-error" | "child-bypassed" | "not-evaluated"

export type ModelUsageKind = "primary" | "title" | "compaction" | "generate"

export type TelemetryModel = {
  providerID: string
  modelID: string
  variant?: string
}

export type ModelUsageEvent = TelemetryModel & {
  agent: string
  kind: ModelUsageKind
  timestamp: string
}

export type ModelUsageAggregate = TelemetryModel & {
  agent: string
  kind: ModelUsageKind
  requests: number
  firstTimestamp: string
  lastTimestamp: string
}

export type LayaTelemetry = {
  status: LayaStatus
  profile?: string
  effectiveProfile?: string
  model?: string
  confidence?: number
  threshold: number
  probabilities?: Record<string, number>
  choiceProbability?: number
  margin?: number
  fallbackReason?: string
  minimumProfile?: string
  decisionReason?: string
  policyVersion?: string
  error?: string
}

export type SessionTelemetry = {
  laya: LayaTelemetry
  usage: readonly ModelUsageAggregate[]
}

export type UsageTokens = {
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
  totalTokens: number
}

export type UsageTotals = UsageTokens & {
  requests: number
  tokenResponses: number
  costResponses: number
  estimatedCost: number | null
  costSource?: CostSource
}

export type CostSource = "native" | "calculated" | "free" | "unavailable"
export type SessionTotals = UsageTokens & { estimatedCost: number | null; costSource?: CostSource }
export type PricingRates = { input: number; output: number; cacheRead?: number; cacheWrite?: number }
export type PricingTable = Record<string, PricingRates>

export type UsageByAgent = UsageTotals & { agent: string }
export type UsageByModel = UsageTotals & TelemetryModel

export type AssistantMessageRecord = {
  type?: string
  agent?: string
  model?: { providerID?: string; id?: string; modelID?: string; variant?: string }
  providerID?: string
  modelID?: string
  variant?: string
  cost?: number
  tokens?: {
    input?: number
    output?: number
    reasoning?: number
    cache?: { read?: number; write?: number }
  }
  time?: { completed?: unknown }
}

export type SessionUsageBreakdown = {
  sessionCount: number
  sessionTotals: SessionTotals
  messageTotals: UsageTotals
  byAgent: UsageByAgent[]
  byModel: UsageByModel[]
}

export type NativeSessionUsage = {
  cost?: number
  tokens?: { input?: number; output?: number; reasoning?: number; cache?: { read?: number; write?: number } }
}

export type NativeSessionInfo = {
  id: string
  agent: string
  model: TelemetryModel
}

export type TelemetrySelectOption = {
  title: string
  value: string
  description?: string
  category?: string
}

const usageKey = (event: ModelUsageEvent): string =>
  JSON.stringify([event.agent, event.providerID, event.modelID, event.variant ?? null, event.kind])

export const aggregateModelUsage = (events: readonly ModelUsageEvent[]): ModelUsageAggregate[] => {
  const aggregates = new Map<string, ModelUsageAggregate>()

  for (const event of events) {
    const key = usageKey(event)
    const current = aggregates.get(key)
    if (!current) {
      aggregates.set(key, {
        agent: event.agent,
        providerID: event.providerID,
        modelID: event.modelID,
        ...(event.variant === undefined ? {} : { variant: event.variant }),
        kind: event.kind,
        requests: 1,
        firstTimestamp: event.timestamp,
        lastTimestamp: event.timestamp,
      })
      continue
    }

    current.requests += 1
    if (event.timestamp < current.firstTimestamp) current.firstTimestamp = event.timestamp
    if (event.timestamp > current.lastTimestamp) current.lastTimestamp = event.timestamp
  }

  return [...aggregates.values()]
}

const emptyUsage = (): UsageTotals => ({
  requests: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0,
  totalTokens: 0, estimatedCost: null, costSource: "unavailable", tokenResponses: 0, costResponses: 0,
})

const emptySessionTotals = (): SessionTotals => ({
  input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0,
  totalTokens: 0, estimatedCost: null, costSource: "unavailable",
})

const finiteOrZero = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0

const hasTokenData = (message: AssistantMessageRecord): boolean => {
  const tokens = message.tokens
  if (!tokens) return false
  return [tokens.input, tokens.output, tokens.reasoning, tokens.cache?.read, tokens.cache?.write]
    .some((value) => typeof value === "number" && Number.isFinite(value))
}

const pricingFor = (message: AssistantMessageRecord, pricing: PricingTable): PricingRates | undefined => {
  const model = messageModel(message)
  return pricing[`${model.providerID}/${model.modelID}${model.variant ? `#${model.variant}` : ""}`] ?? pricing[`${model.providerID}/${model.modelID}`]
}

const calculatedCost = (message: AssistantMessageRecord, rates: PricingRates): number => (
  finiteOrZero(message.tokens?.input) * rates.input +
  finiteOrZero(message.tokens?.output) * rates.output +
  finiteOrZero(message.tokens?.cache?.read) * (rates.cacheRead ?? 0) +
  finiteOrZero(message.tokens?.cache?.write) * (rates.cacheWrite ?? 0)
) / 1_000_000

const addCost = (target: UsageTotals, amount: number, source: Exclude<CostSource, "unavailable">): void => {
  target.costResponses += 1
  target.estimatedCost = (target.estimatedCost ?? 0) + amount
  if (!target.costSource || target.costSource === "unavailable" || target.costSource === "free") target.costSource = source
  else if (target.costSource !== source) target.costSource = "calculated"
}

const addMessageUsage = (target: UsageTotals, message: AssistantMessageRecord, pricing: PricingTable): void => {
  target.requests += 1
  if (hasTokenData(message)) {
    target.tokenResponses += 1
    target.input += finiteOrZero(message.tokens?.input)
    target.output += finiteOrZero(message.tokens?.output)
    target.reasoning += finiteOrZero(message.tokens?.reasoning)
    target.cacheRead += finiteOrZero(message.tokens?.cache?.read)
    target.cacheWrite += finiteOrZero(message.tokens?.cache?.write)
    target.totalTokens += finiteOrZero(message.tokens?.input) + finiteOrZero(message.tokens?.output)
  }
  if (typeof message.cost === "number" && Number.isFinite(message.cost) && message.cost > 0) addCost(target, message.cost, "native")
  else {
    const rates = pricingFor(message, pricing)
    if (rates && hasTokenData(message)) {
      const free = rates.input === 0 && rates.output === 0 && (rates.cacheRead ?? 0) === 0 && (rates.cacheWrite ?? 0) === 0
      addCost(target, calculatedCost(message, rates), free ? "free" : "calculated")
    }
  }
}

const messageModel = (message: AssistantMessageRecord): TelemetryModel => ({
  providerID: message.model?.providerID ?? message.providerID ?? "unknown",
  modelID: message.model?.id ?? message.model?.modelID ?? message.modelID ?? "unknown",
  ...(message.model?.variant ?? message.variant ? { variant: message.model?.variant ?? message.variant } : {}),
})

export const aggregateAssistantMessageUsage = (
  messages: readonly AssistantMessageRecord[],
  pricing: PricingTable = {},
): SessionUsageBreakdown => {
  const completed = messages.filter((message) => message.type === "assistant" && message.time?.completed != null)
  const messageTotals = emptyUsage()
  const agents = new Map<string, UsageByAgent>()
  const models = new Map<string, UsageByModel>()
  for (const message of completed) {
    addMessageUsage(messageTotals, message, pricing)
    const agent = message.agent ?? "unknown"
    const agentUsage = agents.get(agent) ?? { agent, ...emptyUsage() }
    addMessageUsage(agentUsage, message, pricing)
    agents.set(agent, agentUsage)
    const model = messageModel(message)
    const key = JSON.stringify([model.providerID, model.modelID, model.variant ?? null])
    const modelUsage = models.get(key) ?? { ...model, ...emptyUsage() }
    addMessageUsage(modelUsage, message, pricing)
    models.set(key, modelUsage)
  }
  return {
    sessionCount: 1,
    sessionTotals: {
      input: messageTotals.input,
      output: messageTotals.output,
      reasoning: messageTotals.reasoning,
      cacheRead: messageTotals.cacheRead,
      cacheWrite: messageTotals.cacheWrite,
      totalTokens: messageTotals.totalTokens,
      estimatedCost: messageTotals.estimatedCost,
      costSource: messageTotals.costSource,
    },
    messageTotals,
    byAgent: [...agents.values()],
    byModel: [...models.values()],
  }
}

export const withNativeSessionTotals = (
  usage: SessionUsageBreakdown,
  native: NativeSessionUsage | readonly NativeSessionUsage[],
): SessionUsageBreakdown => {
  const natives = Array.isArray(native) ? native : [native]
  const sessionTotals = sumNativeSessionTotals(natives)
  if (sessionTotals.estimatedCost === null && usage.messageTotals.costResponses > 0 && usage.messageTotals.costResponses === usage.messageTotals.tokenResponses) {
    sessionTotals.estimatedCost = usage.messageTotals.estimatedCost
    sessionTotals.costSource = usage.messageTotals.costSource
  }
  return {
    ...usage,
    sessionCount: natives.length,
    sessionTotals,
  }
}

/** Sums OpenCode's content-free native aggregates, ignoring malformed/non-finite values. */
export const sumNativeSessionTotals = (sessions: readonly NativeSessionUsage[]): SessionTotals => {
  const total = emptySessionTotals()
  for (const session of sessions) {
    total.input += finiteOrZero(session.tokens?.input)
    total.output += finiteOrZero(session.tokens?.output)
    total.reasoning += finiteOrZero(session.tokens?.reasoning)
    total.cacheRead += finiteOrZero(session.tokens?.cache?.read)
    total.cacheWrite += finiteOrZero(session.tokens?.cache?.write)
    if (typeof session.cost === "number" && Number.isFinite(session.cost) && session.cost > 0) {
      total.estimatedCost = (total.estimatedCost ?? 0) + session.cost
      total.costSource = "native"
    }
  }
  total.totalTokens = total.input + total.output
  return total
}

const modelName = (model: TelemetryModel): string =>
  `${model.providerID}/${model.modelID}${model.variant === undefined ? "" : `#${model.variant}`}`

const percent = (value: number): string => `${(value * 100).toFixed(1).replace(/\.0$/, "")}%`

const integer = (value: number): string => Math.trunc(value).toLocaleString("en-US")
const shortUsd = (value: number | null): string => value === null ? "Unavailable" : `$${value.toFixed(6)} USD`
const boundedIdentity = (label: string, identity: string): string => {
  const available = 64 - label.length
  return `${label}${identity.length <= available ? identity : `${identity.slice(0, Math.max(0, available - 1))}…`}`
}

const usageRows = (
  usage: UsageTokens & { estimatedCost: number | null; costSource?: CostSource },
  valuePrefix: string,
  category: string,
): TelemetrySelectOption[] => [
  { title: `total ${integer(usage.totalTokens)}`, value: `${valuePrefix}:tokens-total`, category },
  { title: `in ${integer(usage.input)} · out ${integer(usage.output)}`, value: `${valuePrefix}:tokens-in-out`, category },
  { title: `reason ${integer(usage.reasoning)}`, value: `${valuePrefix}:reason`, category },
  { title: `cache read ${integer(usage.cacheRead)}`, value: `${valuePrefix}:cache-read`, category },
  { title: `cache write ${integer(usage.cacheWrite)}`, value: `${valuePrefix}:cache-write`, category },
  { title: `est. cost ${shortUsd(usage.estimatedCost)} · ${usage.costSource ?? "unavailable"}`, value: `${valuePrefix}:cost`, category },
]

const coverageRows = (usage: UsageTotals, valuePrefix: string, category: string): TelemetrySelectOption[] => [
  { title: `requests ${integer(usage.requests)}`, value: `${valuePrefix}:requests`, category },
  { title: `token metadata ${integer(usage.tokenResponses)}/${integer(usage.requests)}`, value: `${valuePrefix}:token-coverage`, category },
  { title: `cost metadata ${integer(usage.costResponses)}/${integer(usage.requests)}`, value: `${valuePrefix}:cost-coverage`, category },
]

type AugmentedTelemetryReport = {
  session: { id?: string; agent: string; model: TelemetryModel }
  telemetry?: SessionTelemetry
  usage: SessionUsageBreakdown
}

/** Creates the compact, content-free view model used by the native scrollable dialog. */
export const formatTelemetrySelectOptions = (
  report: string | AugmentedTelemetryReport,
): TelemetrySelectOption[] => {
  const value = (typeof report === "string" ? JSON.parse(report) : report) as AugmentedTelemetryReport
  const sessionModel = modelName(value.session.model)
  const usedModels = value.usage.byModel.map(modelName)
  const options: TelemetrySelectOption[] = [
    { title: `Total tokens · ${integer(value.usage.sessionTotals.totalTokens)}`, value: "summary:tokens", category: "Summary" },
    { title: `Estimated cost · ${shortUsd(value.usage.sessionTotals.estimatedCost)}`, value: "summary:cost", category: "Summary" },
    ...(usedModels.length ? usedModels.flatMap((model, index) => [
      ...(index === 0 ? [] : [{ title: "────────────────────────", value: `summary:separator:${index}`, category: "Summary" }]),
      { title: boundedIdentity("Model used · ", model), value: `summary:model:${index}:${JSON.stringify(model)}`, category: "Summary" },
    ]) : [{ title: "Models used · none", value: "summary:models:none", category: "Summary" }]),
    ...(value.session.id ? [{ title: boundedIdentity("ID · ", value.session.id), value: `session:id:${value.session.id}`, category: "Session" }] : []),
    { title: boundedIdentity("Agent · ", value.session.agent), value: `session:agent:${value.session.agent}`, category: "Session" },
    { title: boundedIdentity("Model · ", sessionModel), value: `session:model:${sessionModel}`, category: "Session" },
  ]
  const laya = value.telemetry?.laya
  options.push(
    { title: `Laya status · ${laya?.status ?? "telemetry unavailable"}`, value: "laya:status", category: "Session" },
    ...(laya ? [
      { title: boundedIdentity("profile · ", laya.profile ?? "none"), value: `laya:profile:${laya.profile ?? "none"}`, category: "Session" },
      ...(laya.effectiveProfile ? [{ title: boundedIdentity("effective profile · ", laya.effectiveProfile), value: `laya:effective-profile:${laya.effectiveProfile}`, category: "Session" }] : []),
      ...(laya.minimumProfile ? [{ title: boundedIdentity("minimum profile · ", laya.minimumProfile), value: `laya:minimum-profile:${laya.minimumProfile}`, category: "Session" }] : []),
      ...(laya.decisionReason ? [{ title: boundedIdentity("decision · ", laya.decisionReason), value: `laya:decision:${laya.decisionReason}`, category: "Session" }] : []),
      ...(laya.policyVersion ? [{ title: boundedIdentity("policy · ", laya.policyVersion), value: `laya:policy:${laya.policyVersion}`, category: "Session" }] : []),
      { title: `confidence ${laya.confidence === undefined ? "unknown" : percent(laya.confidence)} · threshold ${percent(laya.threshold)}`, value: "laya:confidence-threshold", category: "Session" },
      ...(laya.choiceProbability === undefined ? [] : [{ title: `choice probability · ${percent(laya.choiceProbability)}`, value: "laya:choice-probability", category: "Session" }]),
      ...(laya.margin === undefined ? [] : [{ title: `margin · ${percent(laya.margin)}`, value: "laya:margin", category: "Session" }]),
      { title: boundedIdentity("routed model · ", laya.model ?? "none"), value: `laya:model:${laya.model ?? "none"}`, category: "Session" },
      ...(laya.error ? [{ title: boundedIdentity("error · ", laya.error), value: `laya:error:${laya.error}`, category: "Session" }] : []),
      ...(laya.fallbackReason ? [{ title: boundedIdentity("fallback · ", laya.fallbackReason), value: `laya:fallback:${laya.fallbackReason}`, category: "Session" }] : []),
      ...Object.entries(laya.probabilities ?? {}).map(([profile, probability]) => ({
        title: boundedIdentity("probability · ", `${profile} ${percent(probability)}`),
        value: `laya:probability:${profile}:${probability}`,
        category: "Session",
      })),
    ] : []), {
    title: `Lifetime session-family total · ${value.usage.sessionCount} session${value.usage.sessionCount === 1 ? "" : "s"}`,
    value: "lifetime:count",
    category: "Usage",
  }, ...usageRows(value.usage.sessionTotals, "lifetime", "Usage"),
  { title: "est. cost = OpenCode-recorded estimated cost", value: "usage:cost-legend", category: "Usage" })
  if (!value.usage.byAgent.length && !value.usage.byModel.length) {
    options.push({ title: "No completed assistant responses", value: "no-data", category: "Usage" })
    return options
  }
  for (const [index, row] of value.usage.byAgent.entries()) {
    const prefix = `agent:${row.agent}`
    if (index > 0) options.push({ title: "────────────────────────", value: `agent:separator:${index}`, category: "By agent" })
    options.push({ title: boundedIdentity("Agent · ", row.agent), value: `${prefix}:identity`, category: "By agent" }, ...usageRows(row, prefix, "By agent"), ...coverageRows(row, prefix, "By agent"))
  }
  for (const [index, row] of value.usage.byModel.entries()) {
    const identity = modelName(row)
    const prefix = `model:${JSON.stringify([row.providerID, row.modelID, row.variant ?? null])}`
    if (index > 0) options.push({ title: "────────────────────────", value: `model:separator:${index}`, category: "By model" })
    options.push({ title: boundedIdentity("Model · ", identity), value: `${prefix}:identity`, category: "By model" }, ...usageRows(row, prefix, "By model"), ...coverageRows(row, prefix, "By model"))
  }
  return options
}

export const formatTelemetryMarkdown = (
  session: NativeSessionInfo,
  telemetry: SessionTelemetry | undefined,
): string => {
  const lines = [
    "# Session telemetry",
    "",
    `- ID: \`${session.id}\``,
    `- Agent: ${session.agent}`,
    `- Model: ${modelName(session.model)}`,
  ]

  if (telemetry) {
    if (telemetry.laya.status === "not-evaluated") {
      lines.push(`- Laya: not evaluated for this session (${percent(telemetry.laya.threshold)} threshold)`)
    } else {
      const confidence = telemetry.laya.confidence === undefined ? "unknown" : percent(telemetry.laya.confidence)
      lines.push(`- Laya: ${confidence} confidence, ${percent(telemetry.laya.threshold)} threshold, ${telemetry.laya.status}`)
    }
    if (telemetry.laya.profile) lines.push(`- Profile: ${telemetry.laya.profile}`)
    if (telemetry.laya.effectiveProfile) lines.push(`- Effective profile: ${telemetry.laya.effectiveProfile}`)
    if (telemetry.laya.minimumProfile) lines.push(`- Minimum profile: ${telemetry.laya.minimumProfile}`)
    if (telemetry.laya.decisionReason) lines.push(`- Decision reason: ${telemetry.laya.decisionReason}`)
    if (telemetry.laya.policyVersion) lines.push(`- Policy version: ${telemetry.laya.policyVersion}`)
    if (telemetry.laya.model) lines.push(`- Routed model: ${telemetry.laya.model}`)
    if (telemetry.laya.choiceProbability !== undefined) lines.push(`- Choice probability: ${percent(telemetry.laya.choiceProbability)}`)
    if (telemetry.laya.margin !== undefined) lines.push(`- Margin: ${percent(telemetry.laya.margin)}`)
    if (telemetry.laya.fallbackReason) lines.push(`- Fallback reason: ${telemetry.laya.fallbackReason}`)
    if (telemetry.laya.error) lines.push(`- Error: ${telemetry.laya.error}`)
    if (telemetry.laya.probabilities) {
      lines.push(`- Probabilities: ${Object.entries(telemetry.laya.probabilities).map(([key, value]) => `${key} ${percent(value)}`).join(", ")}`)
    }
    lines.push("", "## Model usage")
    if (telemetry.usage.length === 0) lines.push("No model usage recorded.")
    for (const usage of telemetry.usage) {
      lines.push(
        `- ${usage.agent} — ${modelName(usage)} — ${usage.kind}: ${usage.requests} request${usage.requests === 1 ? "" : "s"} (${usage.firstTimestamp} to ${usage.lastTimestamp})`,
      )
    }
  } else {
    lines.push("- Laya: telemetry unavailable", "", "## Model usage", "Telemetry unavailable.")
  }

  return `${lines.join("\n")}\n`
}

export const formatTelemetryJson = (
  session: NativeSessionInfo,
  telemetry: SessionTelemetry | undefined,
): string => {
  const report = {
    session: {
      id: session.id,
      agent: session.agent,
      model: {
        providerID: session.model.providerID,
        modelID: session.model.modelID,
        ...(session.model.variant === undefined ? {} : { variant: session.model.variant }),
      },
    },
    ...(telemetry === undefined ? {} : { telemetry }),
  }
  return JSON.stringify(report, null, 2)
}

const usageCells = (usage: UsageTotals): string =>
  `${usage.requests} | ${usage.input} | ${usage.output} | ${usage.reasoning} | ${usage.cacheRead} | ${usage.cacheWrite} | ${usage.totalTokens} | ${usage.estimatedCost ?? "Unavailable"} | ${usage.tokenResponses}/${usage.requests} | ${usage.costResponses}/${usage.requests}`

const sessionTotalCells = (usage: SessionTotals): string =>
  `${usage.input} | ${usage.output} | ${usage.reasoning} | ${usage.cacheRead} | ${usage.cacheWrite} | ${usage.totalTokens} | ${usage.estimatedCost ?? "Unavailable"}`

export const augmentTelemetryReport = (
  baseReport: string,
  format: "markdown" | "json",
  usage: SessionUsageBreakdown,
): string => {
  if (format === "json") {
    const base = JSON.parse(baseReport) as Record<string, unknown>
    return JSON.stringify({ summary: { totalTokens: usage.sessionTotals.totalTokens, estimatedCost: usage.sessionTotals.estimatedCost, costSource: usage.sessionTotals.costSource, models: usage.byModel.map(modelName) }, ...base, usage }, null, 2)
  }
  const models = usage.byModel.map(modelName)
  const lines = ["# Summary", "", `- Total tokens: ${usage.sessionTotals.totalTokens}`, `- Estimated cost: ${shortUsd(usage.sessionTotals.estimatedCost)} (${usage.sessionTotals.costSource})`, `- Models used: ${models.length ? models.join(" · ") : "none"}`, "", baseReport.trimEnd(), "", `## Lifetime session-family usage (${usage.sessionCount} session${usage.sessionCount === 1 ? "" : "s"})`, "", "| Input | Output | Reasoning | Cache read | Cache write | Total tokens | Estimated cost |", "| ---: | ---: | ---: | ---: | ---: | ---: | ---: |", `| ${sessionTotalCells(usage.sessionTotals)} |`, "", "Total tokens are input + output. Cost is native when OpenCode records a positive amount, calculated when configured pricing is available, explicitly free for zero-priced models, and unavailable otherwise. The following breakdowns use completed assistant-message metadata; coverage counts are message-level, not lifetime-session coverage.", "", `Completed assistant responses: ${usage.messageTotals.requests}; token data recorded for ${usage.messageTotals.tokenResponses}; cost data recorded for ${usage.messageTotals.costResponses}.`, "", "## By agent", "", "| Agent | Requests | Input | Output | Reasoning | Cache read | Cache write | Total tokens | Estimated cost | Token data | Cost data |", "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |"]
  for (const row of usage.byAgent) lines.push(`| ${row.agent} | ${usageCells(row)} |`)
  if (!usage.byAgent.length) lines.push("| _No completed assistant responses_ | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0/0 | 0/0 |")
  lines.push("", "## By model", "", "| Model | Requests | Input | Output | Reasoning | Cache read | Cache write | Total tokens | Estimated cost | Token data | Cost data |", "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |")
  for (const row of usage.byModel) lines.push(`| ${modelName(row)} | ${usageCells(row)} |`)
  if (!usage.byModel.length) lines.push("| _No completed assistant responses_ | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0/0 | 0/0 |")
  return `${lines.join("\n")}\n`
}
