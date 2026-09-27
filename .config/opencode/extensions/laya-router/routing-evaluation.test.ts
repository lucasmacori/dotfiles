import assert from "node:assert/strict"
import test from "node:test"
import { summarizeRouting } from "./routing-evaluation.ts"

test("reports confusion, profile quality, fallback rate, and dangerous under-routing", () => {
  const result = summarizeRouting([
    { id: "micro", expectedProfile: "micro", selectedProfile: "micro", effectiveProfile: "micro", fallback: false },
    { id: "safe", expectedProfile: "standard", selectedProfile: "micro", effectiveProfile: "standard", fallback: false },
    { id: "danger", expectedProfile: "deep", selectedProfile: "micro", effectiveProfile: "basic", fallback: false },
    { id: "fallback", expectedProfile: "basic", effectiveProfile: "standard", fallback: true },
  ])
  assert.equal(result.total, 4)
  assert.equal(result.exactAccuracy, 0.5)
  assert.equal(result.fallbackRate, 0.25)
  assert.equal(result.dangerousUnderRouting, 1)
  assert.equal(result.unnecessaryOverRouting, 1)
  assert.equal(result.confusion.standard.standard, 1)
  assert.deepEqual(result.profiles.micro, { accepted: 1, expected: 1, precision: 1, recall: 1 })
  assert.equal(result.profiles.standard.precision, 1)
})
