import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { isAbsolute, resolve } from "node:path"

import { validatePolicyProfiles } from "./routing-policy.ts"

export type ProfileModel = { providerID: string; id: string; variant?: string }
export type RoutingProfile = { model: ProfileModel; criteria: string }
export type RoutingProfiles = Record<string, RoutingProfile>

const allowedProfileFields = new Set(["model", "criteria"])
const allowedModelFields = new Set(["providerID", "id", "variant"])

const object = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value)

export const resolveProfilesFile = (path: string): string => {
  const expanded = path === "~" ? homedir() : path.startsWith("~/") ? resolve(homedir(), path.slice(2)) : path
  return isAbsolute(expanded) ? expanded : resolve(process.cwd(), expanded)
}

export const validateProfiles = (value: unknown, source = "profiles"): RoutingProfiles => {
  if (!object(value)) throw new Error(`Invalid laya-router configuration: ${source} must contain a JSON object`)
  validatePolicyProfiles(value as Record<string, { model: unknown }>)
  for (const [name, rawProfile] of Object.entries(value)) {
    if (!object(rawProfile)) throw new Error(`Invalid laya-router configuration: ${source} profile '${name}' must be an object`)
    const unknownProfileField = Object.keys(rawProfile).find((field) => !allowedProfileFields.has(field))
    if (unknownProfileField) throw new Error(`Invalid laya-router configuration: ${source} profile '${name}' has unknown field '${unknownProfileField}'`)
    if (typeof rawProfile.criteria !== "string" || !rawProfile.criteria.trim()) {
      throw new Error(`Invalid laya-router configuration: ${source} profile '${name}' requires non-empty criteria`)
    }
    if (!object(rawProfile.model)) throw new Error(`Invalid laya-router configuration: ${source} profile '${name}' requires a model object`)
    const unknownModelField = Object.keys(rawProfile.model).find((field) => !allowedModelFields.has(field))
    if (unknownModelField) throw new Error(`Invalid laya-router configuration: ${source} profile '${name}' model has unknown field '${unknownModelField}'`)
    for (const field of ["providerID", "id"] as const) {
      if (typeof rawProfile.model[field] !== "string" || !rawProfile.model[field].trim()) {
        throw new Error(`Invalid laya-router configuration: ${source} profile '${name}' requires a non-empty model.${field}`)
      }
    }
    if (rawProfile.model.variant !== undefined && (typeof rawProfile.model.variant !== "string" || !rawProfile.model.variant.trim())) {
      throw new Error(`Invalid laya-router configuration: ${source} profile '${name}' model.variant must be a non-empty string`)
    }
  }
  return value as RoutingProfiles
}

export const loadProfilesFile = (path: string): RoutingProfiles => {
  const resolved = resolveProfilesFile(path)
  let text: string
  try {
    text = readFileSync(resolved, "utf8")
  } catch (error) {
    throw new Error(`Invalid laya-router configuration: cannot read profilesFile '${resolved}': ${String(error)}`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new Error(`Invalid laya-router configuration: profilesFile '${resolved}' is not valid JSON: ${String(error)}`)
  }
  return validateProfiles(parsed, `profilesFile '${resolved}'`)
}
