import assert from "node:assert/strict"
import test from "node:test"
import { evaluateRoutingPolicy, inferMinimumProfile, isMechanicalTransformation, isMicroEligible } from "./routing-policy.ts"
import { ROUTING_CORPUS_VERSION, routingCorpus } from "./routing-corpus.ts"

const profiles = Object.fromEntries(["micro", "basic", "standard", "advanced", "deep"].map((profile) => [profile, { model: profile }]))
const options = { profiles, confidenceThreshold: 0.1, minimumChoiceProbability: 0.45, minimumMargin: 0.1, policyVersion: "v1" }
const decide = (prompt: string, profile: string, confidence = 0.9, choiceProbability = 0.8, margin = 0.4) => evaluateRoutingPolicy(prompt, { profile, confidence, choiceProbability, margin }, options).effectiveProfile

for (const prompt of ['Format: "hello world"', 'Translate: "bonjour"', 'Correct spelling: "teh cat"']) test(`micro supplied transformation: ${prompt}`, () => assert.equal(decide(prompt, "micro"), "micro"))
for (const prompt of ["What is 2 + 2?", "Explain gravity simply", "What is the capital of France?"]) test(`basic stable answer: ${prompt}`, () => assert.equal(decide(prompt, "basic"), "basic"))
test("micro eligibility is capability-based rather than phrase-based", () => {
  assert.equal(isMicroEligible("Bonjour"), true)
  assert.equal(isMicroEligible("Thanks, understood"), true)
  assert.equal(isMicroEligible("Implement this feature"), false)
})
test("attachments alone do not impose a standard floor", () => {
  assert.equal(inferMinimumProfile("Summarize this", { hasAttachments: true }), undefined)
  assert.equal(evaluateRoutingPolicy("Summarize this", { profile: "basic", confidence: 0.9, choiceProbability: 0.8, margin: 0.4 }, options, { hasAttachments: true }).effectiveProfile, "basic")
})
for (const prompt of ["Add a unit test", "Implement this feature", "Review the diff", "Run tests", "Create a new TypeScript file", "Refactor the cache implementation"]) test(`standard floor: ${prompt}`, () => assert.equal(inferMinimumProfile(prompt), "standard"))
for (const prompt of ["Discover the repository structure", "Read README.md and summarize it", "Write the supplied text into notes.md", "Search online for the current exchange rate", "Edit README.md exactly"]) test(`basic or micro tool work has no standard floor: ${prompt}`, () => assert.equal(inferMinimumProfile(prompt), undefined))
test("planning imposes an advanced floor", () => {
  assert.equal(inferMinimumProfile("Plan a React button with tests"), "advanced")
  assert.equal(inferMinimumProfile("Prepare the implementation approach", { agent: "plan" }), "advanced")
  assert.equal(evaluateRoutingPolicy("Plan a React button", { profile: "standard", confidence: 0.9, choiceProbability: 0.8, margin: 0.4 }, options, { agent: "plan" }).effectiveProfile, "advanced")
})
for (const prompt of ["Diagnose a distributed deadlock", "Perform an OAuth migration", "Check tenant authorization security", "Delete production data with compliance and rollback", "Fix it", "Plan a cross-region migration"]) test(`deep floor: ${prompt}`, () => assert.equal(decide(prompt, "micro"), "deep"))
test("low-risk uncertainty falls back to basic instead of standard", () => {
  assert.equal(decide("What is 2 + 2?", "basic", 0.09), "basic")
  assert.equal(decide("Thanks", "micro", 0.9, 0.44), "basic")
  assert.equal(decide("Thanks", "micro", 0.9, 0.8, 0.09), "basic")
  assert.equal(decide("Thanks", "micro", 0.01, 0.8, 0.4), "micro")
})

test("a close micro/basic probability tie resolves to micro when both are the dominant profiles", () => {
  const observedLikeHelloThere = {
    profile: "basic", confidence: 0.0798, choiceProbability: 0.343, margin: 0.0931,
    probabilities: { basic: 0.343, micro: 0.2499, standard: 0.2, advanced: 0.12, deep: 0.0871 },
  }
  const decision = evaluateRoutingPolicy("Hello there", observedLikeHelloThere, options)
  assert.equal(decision.effectiveProfile, "micro")
  assert.equal(decision.decisionReason, "micro/basic ambiguity resolved to micro")
})

test("a low-risk informational choice stays basic when micro is not an adjacent leading alternative", () => {
  const decision = evaluateRoutingPolicy("What is the capital of France?", {
    profile: "basic", confidence: 0.2, choiceProbability: 0.38, margin: 0.12,
    probabilities: { basic: 0.38, standard: 0.26, micro: 0.2, advanced: 0.1, deep: 0.06 },
  }, options)
  assert.equal(decision.effectiveProfile, "basic")
})

test("file and web tools remain available as capabilities independent of profile", () => {
  assert.equal(isMicroEligible("Read this file and copy its supplied title to another file"), true)
  assert.equal(isMicroEligible("Search online for today's weather"), true)
  assert.equal(isMicroEligible("Implement a feature in this repository"), false)
})

test("file-backed translation routes to micro independently of classifier ranking", () => {
  const prompt = "Translate @file.md into engligh and print the result"
  assert.equal(isMechanicalTransformation(prompt), true)
  const decision = evaluateRoutingPolicy(prompt, {
    profile: "standard", confidence: 0.9, choiceProbability: 0.8, margin: 0.6,
    probabilities: { micro: 0.03, basic: 0.04, standard: 0.8, advanced: 0.08, deep: 0.05 },
  }, options)
  assert.equal(decision.effectiveProfile, "micro")
  assert.equal(decision.model, "micro")
  assert.equal(decision.decisionReason, "mechanical transformation policy")
})

test("general classifier decisions route trivial interactions without phrase overrides", () => {
  assert.equal(evaluateRoutingPolicy("Bonjour", { profile: "micro", confidence: 0.0592, choiceProbability: 0.55, margin: 0.1121 }, options).effectiveProfile, "micro")
  assert.equal(evaluateRoutingPolicy("Thanks, got it", { profile: "micro", confidence: 0.8, choiceProbability: 0.7, margin: 0.3 }, options).effectiveProfile, "micro")
  assert.equal(evaluateRoutingPolicy("Bonjour, review the repository", { profile: "micro", confidence: 0.9, choiceProbability: 0.8, margin: 0.4 }, options).effectiveProfile, "standard")
})
test("cheap profiles cannot bypass floors and accepted deep may exceed standard", () => {
  assert.equal(decide("Implement a function", "micro"), "standard")
  assert.equal(decide("Review authentication", "basic"), "deep")
  assert.equal(decide("Review a React component", "deep"), "deep")
  assert.equal(decide("Review a React component", "deep", 0.09), "standard")
})

test(`versioned bilingual safety corpus ${ROUTING_CORPUS_VERSION} has no dangerous under-routing`, () => {
  for (const fixture of routingCorpus) {
    const rawProfile = fixture.expectedProfile
    const decision = evaluateRoutingPolicy(fixture.prompt, {
      profile: rawProfile, confidence: 0.9, choiceProbability: 0.8, margin: 0.4,
    }, options)
    assert.equal(decision.effectiveProfile, fixture.expectedProfile, fixture.id)

    if (fixture.expectedProfile === "standard" || fixture.expectedProfile === "advanced" || fixture.expectedProfile === "deep") {
      const adversarial = evaluateRoutingPolicy(fixture.prompt, {
        profile: "micro", confidence: 0.99, choiceProbability: 0.99, margin: 0.98,
      }, options)
      assert.notEqual(adversarial.effectiveProfile, "micro", fixture.id)
      assert.notEqual(adversarial.effectiveProfile, "basic", fixture.id)
    }
  }
})
