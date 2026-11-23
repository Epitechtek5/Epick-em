import type { MessageKey } from '@/i18n/context'
import type { Invitation, InvitationStatus, InvitationType } from './types'

const TYPE_LABELS: Record<InvitationType, MessageKey> = {
  team: 'invitations.types.team',
  tournament_team: 'invitations.types.tournament_team',
  tournament: 'invitations.types.tournament',
}

const STATUS_LABELS: Record<InvitationStatus, MessageKey> = {
  pending: 'invitations.statuses.pending',
  accepted: 'invitations.statuses.accepted',
  declined: 'invitations.statuses.declined',
  revoked: 'invitations.statuses.revoked',
  expired: 'invitations.statuses.expired',
}

export function invitationTypeLabelKey(type: InvitationType): MessageKey {
  return TYPE_LABELS[type]
}

export function invitationStatusLabelKey(status: InvitationStatus): MessageKey {
  return STATUS_LABELS[status]
}

// Un lien encore « en attente » mais dont toutes les places sont prises ne sert plus.
export function isExhausted(invitation: Invitation): boolean {
  return invitation.is_link && invitation.max_uses !== null && invitation.uses >= invitation.max_uses
}

// Une invitation en attente dont l'échéance est passée sera marquée expirée par le serveur.
export function effectiveStatus(invitation: Invitation, now = Date.now()): InvitationStatus {
  if (invitation.status !== 'pending') return invitation.status
  const expires = Date.parse(invitation.expires_at)
  return Number.isFinite(expires) && expires <= now ? 'expired' : 'pending'
}

// Durées proposées à la création (heures) ; `undefined` laisse la durée par défaut du serveur.
export const VALIDITY_CHOICES = [undefined, 24, 72, 168] as const
