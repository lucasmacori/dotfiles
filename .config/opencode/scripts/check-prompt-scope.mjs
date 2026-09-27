import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const opencodeDirectory = resolve(scriptDirectory, "..")
const configDirectory = dirname(opencodeDirectory)
const read = (path) => readFile(path, "utf8")

const [source, mirror, globalOutput, opencodeOutput, sourceToml, mirrorToml] = await Promise.all([
  read(resolve(configDirectory, ".ruler/AGENTS.md")),
  read(resolve(configDirectory, "ruler/AGENTS.md")),
  read(resolve(configDirectory, "AGENTS.md")),
  read(resolve(opencodeDirectory, "AGENTS.md")),
  read(resolve(configDirectory, ".ruler/ruler.toml")),
  read(resolve(configDirectory, "ruler/ruler.toml")),
])

assert.equal(mirror, source, "ruler/AGENTS.md must mirror .ruler/AGENTS.md")
assert.equal(globalOutput, source, "generated global AGENTS.md is stale")
assert.equal(opencodeOutput, source, "generated opencode/AGENTS.md is stale")

for (const marker of ["ACC-142", "FIRST ACTION", "Original OpenCode agent name", "Your response must be ONLY"]) {
  assert.equal(source.includes(marker), false, `ambient instructions contain scoped marker: ${marker}`)
}

for (const [name, toml] of [[".ruler/ruler.toml", sourceToml], ["ruler/ruler.toml", mirrorToml]]) {
  assert.match(toml, /\[agents\][\s\S]*?include_in_rules\s*=\s*false/, `${name} must disable include_in_rules`)
}

console.log("Prompt scope checks passed")