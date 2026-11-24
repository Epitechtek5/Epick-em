import type { PreviewFailure } from '@/hooks/use-transfer'
import { apiRequest } from '@/lib/api/client'
import { getErrorCode, getFieldErrors } from '@/lib/api/errors'
import { importFile, type FileFormat } from '@/lib/api/files'
import { ApiError } from '@/lib/api/http'
import type { MatchResult, MatchStatus } from '@/features/matches/types'
import type { StepParticipantStatus, StepStatus } from '@/features/steps/types'
import type { TournamentImportReport } from './types'

// Aperçu d'un import de tournois (POST /tournaments/import/preview) : le serveur lit, valide et
// planifie le fichier sans rien écrire. Tout ce qui s'y calcule (points, rangs, progression,
// têtes de série, qualifications) vient du serveur : le client l'affiche sans le recalculer.

export type ImportChangeAction = 'create' | 'update' | 'replace' | 'delete'

export type ImportResource = 'tournament' | 'scoring_rules' | 'participants' | 'teams' | 'steps' | 'matches'

export interface ImportResourceChange {
  resource: ImportResource | (string & {})
  action: ImportChangeAction
  before: number
  after: number
  // Champs modifiés d'un tournoi mis à jour (texte du serveur).
  details?: string
}

export interface ImportPlacement {
  name: string
  seed: number | null
  points: number
  rank: number | null
  status: StepParticipantStatus | (string & {})
}

export interface ImportMatchResult {
  name: string
  points: number
  rank: number | null
  result: MatchResult | (string & {}) | null
}

export interface ImportMatchPreview {
  // Position (à partir de 1) du match dans l'étape.
  index: number
  status: MatchStatus | (string & {})
  // Match (à partir de 1) où avance le vainqueur.
  next: number | null
  participants: ImportMatchResult[]
}

export interface ImportStepPreview {
  position: number
  status: StepStatus | (string & {})
  groups: Array<{ index: number; participants: ImportPlacement[] }>
  matches: ImportMatchPreview[]
}

export interface ImportTournamentChanges {
  game: string
  name: string
  action: ImportChangeAction
  destructive: boolean
  changes: ImportResourceChange[]
  // Conséquences en aval (texte du serveur).
  downstream: string[]
  // Placements et résultats planifiés ; absent d'un serveur qui ne les détaille pas.
  steps?: ImportStepPreview[]
}

export interface TournamentImportPreview {
  preview_id?: string
  expires_in?: number
  valid: boolean
  requires_confirmation: boolean
  tournaments: ImportTournamentChanges[]
  warnings: string[]
  errors: string[]
}

export function previewTournamentImport(format: FileFormat, bytes: Uint8Array) {
  return importFile<TournamentImportPreview>('/tournaments/import/preview', format, bytes)
}

// N'envoie que l'identifiant de l'aperçu validé : le serveur rejoue exactement ce qu'il a montré.
export function applyTournamentImport(previewId: string, confirmDestructive: boolean) {
  return apiRequest<TournamentImportReport>('/tournaments/import/apply', {
    method: 'POST',
    body: { preview_id: previewId, confirm_destructive: confirmDestructive },
  })
}

// Issue d'une confirmation refusée : 410 aperçu expiré ou déjà appliqué, 409 données changées
// depuis l'aperçu ou confirmation destructive manquante, 400 fichier refusé à l'écriture. Une panne
// réseau ou serveur laisse l'issue inconnue : l'import a pu avoir lieu.
export function applyFailure(error: unknown): PreviewFailure {
  if (error instanceof ApiError) {
    const code = getErrorCode(error.body)
    if (error.status === 410) return 'expired'
    if (error.status === 409 && code === 'import_preview_stale') return 'stale'
    if (error.status === 409 && code === 'import_confirmation_required') return 'confirmationRequired'
    if (error.status === 409) return 'stale'
    if (error.status === 400) return 'rejected'
    if (error.status === 401 || error.status === 403) return 'forbidden'
  }
  // Réseau (NetworkError) ou panne serveur : l'issue est inconnue.
  return 'unknown'
}

// Détail du serveur d'un fichier refusé (errors.file), affiché tel quel.
export function fileDetail(error: unknown): string | undefined {
  return error instanceof ApiError ? getFieldErrors(error.body, ['file']).file : undefined
}
