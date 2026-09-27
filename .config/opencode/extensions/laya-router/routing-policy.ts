export const PROFILE_ORDER = ["micro", "basic", "standard", "advanced", "deep"] as const
export type ProfileID = typeof PROFILE_ORDER[number]
export type MinimumProfile = "standard" | "advanced" | "deep" | undefined
export type PromptContext = { hasAttachments?: boolean; agent?: string }
export type PolicyScores = { profile: string; confidence: number; choiceProbability?: number; margin?: number; probabilities?: Record<string, number> }
export type PolicyOptions<T> = { profiles: Record<string, { model: T }>; confidenceThreshold: number; minimumChoiceProbability: number; minimumMargin: number; minimumMicroChoiceProbability?: number; minimumMicroMargin?: number; policyVersion: string }
export type PolicyDecision<T> = { selectedProfile: string; effectiveProfile: ProfileID; model: T; minimumProfile?: Exclude<MinimumProfile, undefined>; decisionReason: string; policyVersion: string }

const deepSignals = /\b(architect(?:ure|ural)?|auth(?:entication|orization)?|oauth|oidc|security|privacy|compliance|migrat(?:e|ion)|production|destructive|data[- ]loss|rollback|zero[- ]downtime|distributed|cross[- ](?:system|region)|incident|architecture|authentification|autorisation|sécurité|confidentialité|conformité|migration|destructi(?:f|ve)|perte de données|retour arrière|sans interruption|distribué|inter[- ]systèmes?)\b/i
const standardSignals = /\b(implement|refactor|debug|tests?|lint|build|compile|deploy|run tests?|run the build|fix (?:the )?(?:bug|failure|tests?|code)|implémenter|refactoriser|déboguer|tester|compiler|déployer|exécuter les tests|corrig(?:er|e|é) (?:les? )?(?:tests?|bug|code|échec))\b/i
const repositoryReview = /\b(?:review|audit|relire|auditer)\b.{0,60}\b(?:repository|repo|codebase|code|diff|pull request|merge request|dépôt|base de code)\b/i
const codeArtifactChange = /\b(?:create|write|add|edit|modify|remove|delete|créer|écrire|ajouter|modifier|supprimer)\b.{0,80}\b(?:function|class|component|endpoint|typescript|javascript|java|spring|python|react|angular|vue|fonction|classe|composant|api)\b/i
const codeBlock = /```[\s\S]*(?:typescript|javascript|java|python|spring|react|angular|vue)[\s\S]*```/i
const vagueDeep = /^\s*(?:fix it|debug this|investigate that|corrige ça|débogue ceci|enquête là-dessus)[.!?]?\s*$/i
const advancedSignals = /\b(plan|planning|implementation plan|technical plan|design approach|roadmap|strategy|planifier|planification|stratégie|feuille de route)\b/i
const deepReasoningSignals = /\b(grill me|challenge me|stress[- ]test|interview me|complicated|complex|ambiguous|ambiguity|grille[- ]moi|challenge[- ]moi|ambigu|ambiguïté|complexe|compliqué)\b/i
const transformationIntent = /\b(translate|translation|format|reformat|convert|extract|correct (?:the )?(?:spelling|grammar)|traduire|traduction|formater|reformater|convertir|extraire|corriger (?:l['’])?(?:orthographe|grammaire))\b/i
const referencedContent = /(?:@|\b)[\w./-]+\.(?:md|txt|csv|json|ya?ml|xml|html?)\b/i

export const inferMinimumProfile = (prompt: string, context: PromptContext = {}): MinimumProfile => {
  if (vagueDeep.test(prompt) || deepSignals.test(prompt) || deepReasoningSignals.test(prompt)) return "deep"
  if (context.agent === "plan" || advancedSignals.test(prompt)) return "advanced"
  if (standardSignals.test(prompt) || repositoryReview.test(prompt) || codeArtifactChange.test(prompt) || codeBlock.test(prompt)) return "standard"
  return undefined
}

export const isMicroEligible = (prompt: string): boolean => inferMinimumProfile(prompt) === undefined
export const isBasicEligible = (prompt: string): boolean => inferMinimumProfile(prompt) === undefined
export const isMechanicalTransformation = (prompt: string): boolean =>
  inferMinimumProfile(prompt) === undefined && transformationIntent.test(prompt) && referencedContent.test(prompt)

export const validatePolicyProfiles = <T>(profiles: Record<string, { model: T }>): void => {
  const keys = Object.keys(profiles).sort()
  const expected = [...PROFILE_ORDER].sort()
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) throw new Error(`routing profiles must be exactly: ${PROFILE_ORDER.join(", ")}`)
}

export const evaluateRoutingPolicy = <T>(prompt: string, raw: PolicyScores, options: PolicyOptions<T>, context: PromptContext = {}): PolicyDecision<T> => {
  validatePolicyProfiles(options.profiles)
  const floor = inferMinimumProfile(prompt, context)
  const passesConfidence = Number.isFinite(raw.confidence) && raw.confidence >= options.confidenceThreshold
  const passesProbabilityAndMargin =
    (raw.choiceProbability ?? 0) >= options.minimumChoiceProbability && Number.isFinite(raw.choiceProbability ?? 0) &&
    (raw.margin ?? 0) >= options.minimumMargin && Number.isFinite(raw.margin ?? 0)
  const passes = passesConfidence && passesProbabilityAndMargin
  const passesMicroDistribution =
    (raw.choiceProbability ?? 0) >= (options.minimumMicroChoiceProbability ?? options.minimumChoiceProbability) && Number.isFinite(raw.choiceProbability ?? 0) &&
    (raw.margin ?? 0) >= (options.minimumMicroMargin ?? options.minimumMargin) && Number.isFinite(raw.margin ?? 0)
  let effective: ProfileID = floor ?? "basic"
  let reason = floor ? `${floor} capability/risk floor` : "low-risk uncertainty fallback"
  if (floor === "deep") { effective = "deep"; reason = "deep capability/risk floor" }
  else if (floor === "standard") {
    if ((raw.profile === "advanced" || raw.profile === "deep") && passes) { effective = raw.profile; reason = `accepted ${raw.profile} classification above standard floor` }
    else reason = "standard capability floor"
  } else if (floor === "advanced") {
    if (raw.profile === "deep" && passes) { effective = "deep"; reason = "accepted deep classification above advanced floor" }
    else { effective = "advanced"; reason = "advanced planning/capability floor" }
  } else if (isMechanicalTransformation(prompt)) {
    effective = "micro"; reason = "mechanical transformation policy"
  } else if (raw.profile === "standard") { effective = "standard"; reason = "standard classification accepted" }
  else if (raw.profile === "advanced") {
    effective = passes ? "advanced" : "standard"
    reason = passes ? "advanced classification passed policy gates" : "uncertain advanced classification fell back to standard"
  }
  else if (raw.profile === "deep") {
    effective = passes ? "deep" : "standard"
    reason = passes ? "deep classification passed policy gates" : "uncertain deep classification fell back to standard"
  } else if (raw.profile === "basic" && isMicroEligible(prompt) && raw.probabilities && adjacentCheapProfiles(raw.probabilities)) {
    effective = "micro"; reason = "micro/basic ambiguity resolved to micro"
  } else if (raw.profile === "micro" && isMicroEligible(prompt) && passesMicroDistribution) {
    effective = "micro"; reason = passesConfidence ? "micro classification passed policy gates" : "micro classification accepted from probability and margin"
  } else if (raw.profile === "basic" && isBasicEligible(prompt)) {
    effective = "basic"; reason = passes ? "basic classification passed policy gates" : "low-risk classification fell back to basic"
  } else if (!PROFILE_ORDER.includes(raw.profile as ProfileID)) reason = "unknown classification fell back by capability"
  return { selectedProfile: raw.profile, effectiveProfile: effective, model: options.profiles[effective]!.model, ...(floor ? { minimumProfile: floor } : {}), decisionReason: reason, policyVersion: options.policyVersion }
}

const adjacentCheapProfiles = (probabilities: Record<string, number>): boolean => {
  const ordered = Object.entries(probabilities).sort((a, b) => b[1] - a[1])
  if (ordered.length < 2) return false
  const [first, second] = ordered
  const cheap = new Set(["micro", "basic"])
  return Boolean(first && second && cheap.has(first[0]) && cheap.has(second[0]) && first[0] !== second[0] &&
    first[1] + second[1] >= 0.55 && Math.abs(first[1] - second[1]) <= 0.10)
}
