import type { AssignableTeamRole } from '@/features/teams/types'

// Contrat du moteur d'invitations (api-public/invitations.rs, store/invitations.rs).
export const INVITATION_TYPES = ['team', 'tournament_team', 'tournament'] as const
export const INVITATION_STATUSES = ['pending', 'accepted', 'declined', 'revoked', 'expired'] as const

export type InvitationType = (typeof INVITATION_TYPES)[number]
export type InvitationStatus = (typeof INVITATION_STATUSES)[number]
export type InvitationDirection = 'incoming' | 'outgoing'

// Invitation telle que renvoyée par le serveur : jamais le jeton ni son empreinte.
export interface Invitation {
  id: string
  type: InvitationType
  resource_id: string
  inviter_id: string
  // null pour une invitation par lien.
  recipient_id: string | null
  // Rôle attribué dans une équipe ; null pour un tournoi.
  role: AssignableTeamRole | null
  status: InvitationStatus
  is_link: boolean
  // Acceptations maximales d'un lien ; null pour une invitation à un compte.
  max_uses: number | null
  uses: number
  expires_at: string
  created_at: string
  updated_at: string
  responded_at: string | null
}

export interface InvitationPage {
  items: Invitation[]
  total: number
  limit: number
  offset: number
}

export interface InvitationQuery {
  direction: InvitationDirection
  status?: InvitationStatus
  type?: InvitationType
  limit?: number
  offset?: number
}

// Création : `recipient_id` pour un compte ; sans lui, un lien partageable.
export interface InvitationInput {
  type: InvitationType
  resource_id: string
  recipient_id?: string
  role?: AssignableTeamRole
  max_uses?: number
  expires_in_hours?: number
}

// Le jeton et le lien ne sont renvoyés qu'à la création d'un lien : ils ne sont plus récupérables.
export interface CreatedInvitation extends Invitation {
  token: string | null
  link: string | null
}

// Ce que révèle un lien à son porteur connecté.
export interface InvitationLinkPreview {
  type: InvitationType
  resource_name: string
  inviter_username: string
  role: AssignableTeamRole | null
  expires_at: string
}

export interface AcceptedLink {
  invitation_id: string
  type: InvitationType
  resource_id: string
  role: AssignableTeamRole | null
}

export type InvitationAction = 'accept' | 'decline' | 'revoke' | 'resend'
