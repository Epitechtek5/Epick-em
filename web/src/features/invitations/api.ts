import { getTeam, getTournamentTeam } from '@/features/teams/api'
import { uuid } from '@/features/teams/validation'
import { getTournament } from '@/features/tournaments/api'
import { apiRequest } from '@/lib/api/client'
import { ApiError } from '@/lib/api/http'
import type {
  AcceptedLink,
  CreatedInvitation,
  Invitation,
  InvitationAction,
  InvitationInput,
  InvitationLinkPreview,
  InvitationPage,
  InvitationQuery,
  InvitationType,
} from './types'

export const INVITATIONS_PAGE_SIZE = 10

export async function listInvitations(query: InvitationQuery, signal?: AbortSignal) {
  const params = new URLSearchParams({
    direction: query.direction,
    limit: String(Math.min(100, Math.max(1, Math.trunc(query.limit ?? INVITATIONS_PAGE_SIZE)))),
    offset: String(Math.max(0, Math.trunc(query.offset ?? 0))),
  })
  if (query.status) params.set('status', query.status)
  if (query.type) params.set('type', query.type)
  return apiRequest<InvitationPage>(`/invitations?${params}`, { signal })
}

// Invitations envoyées par le compte pour une ressource (le serveur ne filtre que par type) :
// toutes les pages sont lues, puis seules celles de la ressource sont gardées.
export async function listSentForResource(
  type: InvitationType,
  resourceId: string,
  signal?: AbortSignal,
): Promise<Invitation[]> {
  const found: Invitation[] = []
  for (let offset = 0; offset < 5000; offset += 100) {
    const page = await listInvitations({ direction: 'outgoing', type, limit: 100, offset }, signal)
    found.push(...page.items.filter((invitation) => invitation.resource_id === resourceId))
    if (page.items.length < 100 || offset + page.items.length >= page.total) break
  }
  return found
}

export async function getInvitation(id: string, signal?: AbortSignal) {
  return apiRequest<Invitation>(`/invitations/${uuid(id)}`, { signal })
}

export async function createInvitation(input: InvitationInput) {
  return apiRequest<CreatedInvitation>('/invitations', {
    method: 'POST',
    body: {
      ...input,
      resource_id: uuid(input.resource_id),
      ...(input.recipient_id ? { recipient_id: uuid(input.recipient_id) } : {}),
    },
    expectedStatus: 201,
  })
}

export async function actOnInvitation(id: string, action: InvitationAction) {
  return apiRequest<Invitation>(`/invitations/${uuid(id)}/${action}`, { method: 'POST' })
}

// Jeton d'un lien : 32 à 256 caractères base64url ; tout autre texte n'est jamais envoyé.
export function isInvitationToken(value: string | undefined): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{32,256}$/.test(value)
}

function linkPath(token: string) {
  if (!isInvitationToken(token)) throw new ApiError(404, { error: 'not_found' })
  return `/invitation-links/${encodeURIComponent(token)}`
}

export async function previewInvitationLink(token: string, signal?: AbortSignal) {
  return apiRequest<InvitationLinkPreview>(linkPath(token), { signal })
}

export async function acceptInvitationLink(token: string) {
  return apiRequest<AcceptedLink>(`${linkPath(token)}/accept`, { method: 'POST' })
}

// Page de la ressource visée par une invitation.
export function invitationResourcePath(type: InvitationType, resourceId: string): string {
  const collection = type === 'team' ? 'teams' : type === 'tournament_team' ? 'tournament-teams' : 'tournaments'
  return `/${collection}/${resourceId}`
}

// Nom de la ressource ; null si elle n'existe plus ou n'est pas visible par le compte.
export async function invitationResourceName(
  type: InvitationType,
  resourceId: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const load =
    type === 'team' ? getTeam : type === 'tournament_team' ? getTournamentTeam : getTournament
  return load(resourceId, signal).then(
    (resource) => resource.name,
    () => null,
  )
}
