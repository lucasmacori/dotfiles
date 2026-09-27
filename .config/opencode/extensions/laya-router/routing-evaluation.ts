import { PROFILE_ORDER, type ProfileID } from "./routing-policy.ts"

export type RoutingObservation = {
  id: string
  expectedProfile: ProfileID
  selectedProfile?: string
  confidence?: number
  choiceProbability?: number
  margin?: number
  probabilities?: Record<string, number>
  effectiveProfile: ProfileID
  fallback: boolean
}

export type ProfileMetrics = { accepted: number; expected: number; precision: number | null; recall: number }

export type RoutingEvaluation = {
  total: number
  exactAccuracy: number
  fallbackRate: number
  dangerousUnderRouting: number
  unnecessaryOverRouting: number
  confusion: Record<ProfileID, Record<ProfileID, number>>
  profiles: Record<ProfileID, ProfileMetrics>
}

const rank = (profile: ProfileID): number => PROFILE_ORDER.indexOf(profile)

export const summarizeRouting = (observations: readonly RoutingObservation[]): RoutingEvaluation => {
  const confusion = Object.fromEntries(PROFILE_ORDER.map((expected) => [
    expected,
    Object.fromEntries(PROFILE_ORDER.map((actual) => [actual, 0])) as Record<ProfileID, number>,
  ])) as Record<ProfileID, Record<ProfileID, number>>
  for (const observation of observations) confusion[observation.expectedProfile][observation.effectiveProfile] += 1

  const profiles = Object.fromEntries(PROFILE_ORDER.map((profile) => {
    const accepted = observations.filter((item) => item.effectiveProfile === profile).length
    const expected = observations.filter((item) => item.expectedProfile === profile).length
    const safelyAccepted = observations.filter((item) =>
      item.effectiveProfile === profile && rank(item.effectiveProfile) >= rank(item.expectedProfile)).length
    const exact = observations.filter((item) => item.expectedProfile === profile && item.effectiveProfile === profile).length
    return [profile, { accepted, expected, precision: accepted ? safelyAccepted / accepted : null, recall: expected ? exact / expected : 0 }]
  })) as Record<ProfileID, ProfileMetrics>

  const dangerousUnderRouting = observations.filter((item) =>
    (item.expectedProfile === "standard" || item.expectedProfile === "deep") && rank(item.effectiveProfile) < rank("standard")).length
  const exact = observations.filter((item) => item.expectedProfile === item.effectiveProfile).length
  const unnecessaryOverRouting = observations.filter((item) => rank(item.effectiveProfile) > rank(item.expectedProfile)).length
  return {
    total: observations.length,
    exactAccuracy: observations.length ? exact / observations.length : 0,
    fallbackRate: observations.length ? observations.filter((item) => item.fallback).length / observations.length : 0,
    dangerousUnderRouting,
    unnecessaryOverRouting,
    confusion,
    profiles,
  }
}
