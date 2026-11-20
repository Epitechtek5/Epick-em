import { uuid } from '@/features/teams/validation'
import { apiRequest } from '@/lib/api/client'
import type { Match } from '@/features/matches/types'
import {
  BEST_OF_VALUES,
  DEFAULT_RULES,
  type BestOf,
  type CloseStepResult,
  type GenerationPreview,
  type GroupRanking,
  type Step,
  type StepChanges,
  type StepInput,
  type StepRules,
} from './types'

const base = (tournamentId: string) => `/tournaments/${uuid(tournamentId)}/steps`
const one = (tournamentId: string, stepId: string) => `${base(tournamentId)}/${uuid(stepId)}`

const bestOf = (value: unknown): BestOf | null =>
  BEST_OF_VALUES.includes(value as BestOf) ? (value as BestOf) : null

// Réglages avancés d'une étape ; une étape historique (sans `rules`) prend les valeurs par défaut
// du serveur.
export function normalizeRules(value: unknown): StepRules {
  if (!value || typeof value !== 'object') return { ...DEFAULT_RULES, best_of_by_round: {} }
  const rules = value as Partial<StepRules>
  const byRound: Record<string, BestOf> = {}
  for (const [round, series] of Object.entries(rules.best_of_by_round ?? {})) {
    const valid = bestOf(series)
    if (valid) byRound[round] = valid
  }
  return {
    seeding: rules.seeding ?? DEFAULT_RULES.seeding,
    qualification: rules.qualification ?? DEFAULT_RULES.qualification,
    best_of: bestOf(rules.best_of) ?? 1,
    best_of_by_round: byRound,
    scoring: rules.scoring
      ? {
          win: rules.scoring.win ?? 0,
          draw: rules.scoring.draw ?? 0,
          loss: rules.scoring.loss ?? 0,
          placement: Array.isArray(rules.scoring.placement) ? rules.scoring.placement : [],
        }
      : null,
  }
}

// `tiebreak` est un JSON libre côté serveur : seules les chaînes sont gardées.
export function normalizeStep(step: Step): Step {
  const tiebreak: unknown = step.tiebreak
  return {
    ...step,
    tiebreak: Array.isArray(tiebreak) ? tiebreak.filter((key): key is string => typeof key === 'string') : [],
    rules: normalizeRules(step.rules),
  }
}

// Étapes du tournoi, triées par position (le serveur les trie déjà ; tri gardé par sûreté).
export async function listSteps(tournamentId: string, signal?: AbortSignal) {
  const steps = await apiRequest<Step[]>(base(tournamentId), { signal })
  return steps.map(normalizeStep).sort((a, b) => a.position - b.position)
}

export async function getStep(tournamentId: string, stepId: string, signal?: AbortSignal) {
  return normalizeStep(await apiRequest<Step>(one(tournamentId, stepId), { signal }))
}

// Créée au statut `pending` ; 409 step_position_taken ou tournament_locked.
export async function createStep(tournamentId: string, input: StepInput) {
  return normalizeStep(
    await apiRequest<Step>(base(tournamentId), { method: 'POST', body: input, expectedStatus: 201 }),
  )
}

export async function updateStep(tournamentId: string, stepId: string, changes: StepChanges) {
  return normalizeStep(await apiRequest<Step>(one(tournamentId, stepId), { method: 'PATCH', body: changes }))
}

// 204 ; supprime aussi les groupes et participants de l'étape.
export async function deleteStep(tournamentId: string, stepId: string): Promise<void> {
  await apiRequest(one(tournamentId, stepId), { method: 'DELETE', expectedStatus: 204 })
}

// Groupes et classement tels que calculés par le serveur ; vide tant que l'étape n'est pas lancée.
export async function getStepRanking(tournamentId: string, stepId: string, signal?: AbortSignal) {
  const groups = await apiRequest<GroupRanking[]>(`${one(tournamentId, stepId)}/ranking`, { signal })
  return [...groups].sort((a, b) => a.index - b.index)
}

// Têtes de série puis répartition en serpentin par le serveur ; `seedOrder` (tous les
// participants, la tête de série 1 en premier) seulement quand `rules.seeding` vaut `manual`.
// 400 (errors.steps / errors.participants / errors.seed_order), 409.
export async function startStep(tournamentId: string, stepId: string, seedOrder?: readonly string[]) {
  return normalizeStep(
    await apiRequest<Step>(`${one(tournamentId, stepId)}/start`, {
      method: 'POST',
      body: seedOrder ? { seed_order: seedOrder } : {},
    }),
  )
}

// Matchs que le serveur générerait, sans rien enregistrer ; 409 si l'étape n'est pas en cours ou
// a déjà des matchs.
export async function previewGeneration(tournamentId: string, stepId: string, signal?: AbortSignal) {
  return apiRequest<GenerationPreview>(`${one(tournamentId, stepId)}/generation-preview`, { signal })
}

// Génère les matchs prévisualisés ; 409 si le plan a changé depuis l'aperçu (`revision`).
export async function generateMatches(tournamentId: string, stepId: string, revision: string) {
  return apiRequest<{ matches: Match[] }>(`${one(tournamentId, stepId)}/generate`, {
    method: 'POST',
    body: { revision },
    expectedStatus: 201,
  })
}

// Ronde suisse suivante ; 400 `pairing` si seules des revanches sont possibles.
export async function generateNextRound(tournamentId: string, stepId: string, allowRematches = false) {
  return apiRequest<{ matches: Match[] }>(`${one(tournamentId, stepId)}/rounds`, {
    method: 'POST',
    body: { allow_rematches: allowRematches },
    expectedStatus: 201,
  })
}

// Qualifie les premiers de chaque groupe ; l'étape suivante peut s'ouvrir seule.
export async function closeStep(tournamentId: string, stepId: string): Promise<CloseStepResult> {
  const result = await apiRequest<CloseStepResult>(`${one(tournamentId, stepId)}/close`, { method: 'POST' })
  return { step: normalizeStep(result.step), next_step: result.next_step ? normalizeStep(result.next_step) : null }
}
