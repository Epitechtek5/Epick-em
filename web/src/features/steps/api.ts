import { uuid } from '@/features/teams/validation'
import { apiRequest } from '@/lib/api/client'
import type { CloseStepResult, GroupRanking, Step, StepChanges, StepInput } from './types'

const base = (tournamentId: string) => `/tournaments/${uuid(tournamentId)}/steps`
const one = (tournamentId: string, stepId: string) => `${base(tournamentId)}/${uuid(stepId)}`

// `tiebreak` est un JSON libre côté serveur : seules les chaînes sont gardées.
export function normalizeStep(step: Step): Step {
  const tiebreak: unknown = step.tiebreak
  return {
    ...step,
    tiebreak: Array.isArray(tiebreak) ? tiebreak.filter((key): key is string => typeof key === 'string') : [],
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

// Tirage au sort des groupes par le serveur ; 400 (errors.steps / errors.participants), 409.
export async function startStep(tournamentId: string, stepId: string) {
  return normalizeStep(await apiRequest<Step>(`${one(tournamentId, stepId)}/start`, { method: 'POST' }))
}

// Qualifie les premiers de chaque groupe ; l'étape suivante peut s'ouvrir seule.
export async function closeStep(tournamentId: string, stepId: string): Promise<CloseStepResult> {
  const result = await apiRequest<CloseStepResult>(`${one(tournamentId, stepId)}/close`, { method: 'POST' })
  return { step: normalizeStep(result.step), next_step: result.next_step ? normalizeStep(result.next_step) : null }
}
