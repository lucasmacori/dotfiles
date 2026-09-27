import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { loadProfilesFile, resolveProfilesFile, validateProfiles } from "./profile-config.ts"

const valid = {
  micro: { model: { providerID: "ollama", id: "small" }, criteria: "transform" },
  basic: { model: { providerID: "openai", id: "small", variant: "low" }, criteria: "answer" },
  standard: { model: { providerID: "openai", id: "standard", variant: "low" }, criteria: "engineer" },
  advanced: { model: { providerID: "openai", id: "advanced", variant: "low" }, criteria: "plan" },
  deep: { model: { providerID: "openai", id: "standard", variant: "high" }, criteria: "reason" },
}

test("loads and validates routing profiles from JSON", () => {
  const directory = mkdtempSync(join(tmpdir(), "laya-profiles-"))
  const path = join(directory, "profiles.json")
  writeFileSync(path, JSON.stringify(valid))
  assert.deepEqual(loadProfilesFile(path), valid)
})

test("rejects malformed files and invalid profile fields", () => {
  const directory = mkdtempSync(join(tmpdir(), "laya-profiles-"))
  const malformed = join(directory, "malformed.json")
  writeFileSync(malformed, "{")
  assert.throws(() => loadProfilesFile(malformed), /is not valid JSON/)
  assert.throws(() => loadProfilesFile(join(directory, "missing.json")), /cannot read profilesFile/)
  assert.throws(() => validateProfiles({ ...valid, micro: { ...valid.micro, typo: true } }), /unknown field 'typo'/)
  assert.throws(() => validateProfiles({ ...valid, basic: { ...valid.basic, model: { ...valid.basic.model, variant: "" } } }), /model\.variant/)
})

test("requires exactly the policy profile set", () => {
  const { deep: _deep, ...missing } = valid
  assert.throws(() => validateProfiles(missing), /routing profiles must be exactly/)
  assert.throws(() => validateProfiles({ ...valid, extra: valid.deep }), /routing profiles must be exactly/)
})

test("resolves relative and home-relative profile paths", () => {
  assert.equal(resolveProfilesFile("profiles.json"), join(process.cwd(), "profiles.json"))
  assert.equal(resolveProfilesFile("~/profiles.json").endsWith("/profiles.json"), true)
})
