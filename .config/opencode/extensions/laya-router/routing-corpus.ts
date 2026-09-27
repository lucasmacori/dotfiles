import type { ProfileID } from "./routing-policy.ts"

export type RoutingCorpusCase = {
  id: string
  locale: "en" | "fr"
  category: "interaction" | "transformation" | "simple" | "engineering" | "planning" | "high-risk" | "adversarial"
  prompt: string
  expectedProfile: ProfileID
}

export const ROUTING_CORPUS_VERSION = "2026-09-27-v5"

export const routingCorpus: readonly RoutingCorpusCase[] = [
  { id: "en-greeting", locale: "en", category: "interaction", prompt: "Hello", expectedProfile: "micro" },
  { id: "observed-hello-there", locale: "en", category: "interaction", prompt: "Hello there", expectedProfile: "micro" },
  { id: "fr-greeting", locale: "fr", category: "interaction", prompt: "Bonjour", expectedProfile: "micro" },
  { id: "en-acknowledgement", locale: "en", category: "interaction", prompt: "Thanks, understood.", expectedProfile: "micro" },
  { id: "fr-acknowledgement", locale: "fr", category: "interaction", prompt: "Merci, c'est noté.", expectedProfile: "micro" },
  { id: "en-format", locale: "en", category: "transformation", prompt: 'Format: "alpha, beta, gamma"', expectedProfile: "micro" },
  { id: "fr-translate", locale: "fr", category: "transformation", prompt: 'Traduire : "hello world"', expectedProfile: "micro" },
  { id: "observed-file-translation", locale: "en", category: "transformation", prompt: "Translate @file.md into engligh and print the result", expectedProfile: "micro" },
  { id: "en-trivia", locale: "en", category: "simple", prompt: "What is the capital of France?", expectedProfile: "basic" },
  { id: "fr-arithmetic", locale: "fr", category: "simple", prompt: "Combien font 12 × 8 ?", expectedProfile: "basic" },
  { id: "en-explanation", locale: "en", category: "simple", prompt: "Explain gravity simply", expectedProfile: "basic" },
  { id: "fr-drafting", locale: "fr", category: "simple", prompt: "Rédige un court message pour remercier mon équipe", expectedProfile: "basic" },
  { id: "observed-typescript-file", locale: "en", category: "engineering", prompt: "Create a new TypeScript file for the cache adapter", expectedProfile: "standard" },
  { id: "observed-readme-edit", locale: "en", category: "simple", prompt: "Edit README.md exactly as described", expectedProfile: "basic" },
  { id: "en-tests", locale: "en", category: "engineering", prompt: "Run the unit tests and fix the failure", expectedProfile: "standard" },
  { id: "fr-component", locale: "fr", category: "engineering", prompt: "Créer un composant React et ajouter ses tests", expectedProfile: "standard" },
  { id: "en-plan", locale: "en", category: "planning", prompt: "Plan the implementation of a paginated product list", expectedProfile: "advanced" },
  { id: "fr-plan", locale: "fr", category: "planning", prompt: "Planifier l'implémentation d'un formulaire multi-étapes", expectedProfile: "advanced" },
  { id: "observed-production-delete", locale: "en", category: "high-risk", prompt: "Delete production customer records with compliance checks and rollback", expectedProfile: "deep" },
  { id: "observed-vague-fix", locale: "en", category: "high-risk", prompt: "Fix it", expectedProfile: "deep" },
  { id: "fr-auth-migration", locale: "fr", category: "high-risk", prompt: "Migrer l'authentification en production sans interruption", expectedProfile: "deep" },
  { id: "fr-vague-debug", locale: "fr", category: "high-risk", prompt: "Débogue ceci", expectedProfile: "deep" },
  { id: "mixed-transform-code", locale: "en", category: "adversarial", prompt: 'Translate "hello", then implement the endpoint', expectedProfile: "standard" },
  { id: "mixed-format-security", locale: "en", category: "adversarial", prompt: 'Format this security migration plan: "draft"', expectedProfile: "deep" },
  { id: "greeting-then-engineering", locale: "fr", category: "adversarial", prompt: "Bonjour, analyse le dépôt et corrige les tests", expectedProfile: "standard" },
]
