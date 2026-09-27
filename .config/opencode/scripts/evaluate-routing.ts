import { classifyPrompt, defaultProfiles, type RouterOptions } from "../extensions/laya-router/index.ts"
import { routingCorpus, ROUTING_CORPUS_VERSION } from "../extensions/laya-router/routing-corpus.ts"
import { summarizeRouting, type RoutingObservation } from "../extensions/laya-router/routing-evaluation.ts"
import { evaluateRoutingPolicy } from "../extensions/laya-router/routing-policy.ts"

const options: RouterOptions = {
  endpoint: process.env.LAYA_ENDPOINT ?? "http://127.0.0.1:8765/v1/systemone",
  timeoutMs: 3_000,
  profiles: defaultProfiles,
}
const policy = {
  profiles: defaultProfiles,
  confidenceThreshold: 0.10,
  minimumChoiceProbability: 0.45,
  minimumMargin: 0.10,
  minimumMicroChoiceProbability: 0.35,
  minimumMicroMargin: 0.05,
  policyVersion: ROUTING_CORPUS_VERSION,
}

const observations: RoutingObservation[] = []
for (const fixture of routingCorpus) {
  try {
    const route = await classifyPrompt(fixture.prompt, options)
    if (!route) throw new Error("missing route")
    const decision = evaluateRoutingPolicy(fixture.prompt, route, policy)
    observations.push({
      id: fixture.id,
      expectedProfile: fixture.expectedProfile,
      selectedProfile: route.profile,
      confidence: route.confidence,
      choiceProbability: route.choiceProbability,
      margin: route.margin,
      probabilities: route.probabilities,
      effectiveProfile: decision.effectiveProfile,
      fallback: false,
    })
  } catch {
    observations.push({ id: fixture.id, expectedProfile: fixture.expectedProfile, effectiveProfile: "standard", fallback: true })
  }
}

const report = { corpusVersion: ROUTING_CORPUS_VERSION, ...summarizeRouting(observations), observations }
console.log(JSON.stringify(report, null, 2))

const microPrecision = report.profiles.micro.precision
const basicPrecision = report.profiles.basic.precision
if (report.dangerousUnderRouting > 0 || (microPrecision !== null && microPrecision < 0.95) ||
  (basicPrecision !== null && basicPrecision < 0.90)) process.exitCode = 1
