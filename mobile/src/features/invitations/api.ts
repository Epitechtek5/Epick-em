import { authenticatedRequest, ApiError } from '@/lib/api';
import { accountId, authenticatedHeaders, getUser } from '@/features/users/api';
import { getTeam, getTournamentTeam } from '@/features/teams/api';
import { getTournament } from '@/features/tournaments/api';

export const invitationTypes = [
  'team',
  'tournament_team',
  'tournament',
] as const;
export const invitationStatuses = [
  'pending',
  'accepted',
  'declined',
  'revoked',
  'expired',
] as const;
export type InvitationType = (typeof invitationTypes)[number];
export type InvitationStatus = (typeof invitationStatuses)[number];
export type InvitationAction = 'accept' | 'decline' | 'revoke' | 'resend';
export interface Invitation {
  id: string;
  type: InvitationType;
  resource_id: string;
  inviter_id: string;
  recipient_id: string | null;
  role: 'member' | 'substitute' | null;
  status: InvitationStatus;
  is_link: boolean;
  max_uses: number | null;
  uses: number;
  expires_at: string;
  created_at: string;
  updated_at: string;
  responded_at: string | null;
}
export interface InvitationPreview {
  type: InvitationType;
  resource_name: string;
  inviter_username: string;
  role: Invitation['role'];
  expires_at: string;
}
export interface InvitationPage {
  items: Invitation[];
  total: number;
  limit: number;
  offset: number;
}
export interface InvitationInput {
  type: InvitationType;
  resource_id: string;
  recipient_id?: string;
  role?: 'member' | 'substitute';
  max_uses?: number;
  expires_in_hours?: number;
}
export interface CreatedInvitation extends Invitation {
  token: string | null;
  link: string | null;
}
export interface AcceptedInvitationLink {
  invitation_id: string;
  type: InvitationType;
  resource_id: string;
  role: Invitation['role'];
}

export function listInvitations(
  token: string,
  query: {
    direction: 'incoming' | 'outgoing';
    status?: InvitationStatus;
    type?: InvitationType;
    offset?: number;
  },
) {
  const params = new URLSearchParams({
    direction: query.direction,
    limit: '20',
    offset: String(query.offset ?? 0),
  });
  if (query.status) params.set('status', query.status);
  if (query.type) params.set('type', query.type);
  return authenticatedRequest<InvitationPage>(`/invitations?${params}`, {
    headers: authenticatedHeaders(token),
  });
}
export function getInvitation(token: string, id: string) {
  return authenticatedRequest<Invitation>(`/invitations/${accountId(id)}`, {
    headers: authenticatedHeaders(token),
  });
}
export function createInvitation(token: string, input: InvitationInput) {
  return authenticatedRequest<CreatedInvitation>('/invitations', {
    method: 'POST',
    headers: authenticatedHeaders(token),
    body: JSON.stringify(input),
  });
}
export function actOnInvitation(
  token: string,
  id: string,
  action: InvitationAction,
) {
  return authenticatedRequest<Invitation>(
    `/invitations/${accountId(id)}/${action}`,
    {
      method: 'POST',
      headers: authenticatedHeaders(token),
    },
  );
}
export function validInvitationToken(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{32,256}$/.test(value);
}
function linkPath(secret: string) {
  if (!validInvitationToken(secret))
    throw new Error('Invalid invitation token');
  return `/invitation-links/${encodeURIComponent(secret)}`;
}
export function resolveInvitationLink(token: string, secret: string) {
  return authenticatedRequest<InvitationPreview>(linkPath(secret), {
    headers: authenticatedHeaders(token),
  });
}
export function acceptInvitationLink(token: string, secret: string) {
  return authenticatedRequest<AcceptedInvitationLink>(
    `${linkPath(secret)}/accept`,
    { method: 'POST', headers: authenticatedHeaders(token) },
  );
}
export async function invitationResource(
  token: string,
  type: InvitationType,
  id: string,
) {
  if (type === 'team') return getTeam(token, id);
  if (type === 'tournament_team') return getTournamentTeam(token, id);
  return getTournament(token, id);
}
export async function invitationNames(token: string, invitation: Invitation) {
  const [resource, inviter, recipient] = await Promise.all([
    invitationResource(token, invitation.type, invitation.resource_id).catch(
      () => null,
    ),
    getUser(token, invitation.inviter_id).catch(() => null),
    invitation.recipient_id
      ? getUser(token, invitation.recipient_id).catch(() => null)
      : Promise.resolve(null),
  ]);
  return {
    resource: resource?.name,
    inviter: inviter?.username,
    recipient: recipient?.username,
  };
}
export function invitationErrorKey(error: unknown): string {
  if (!(error instanceof ApiError)) return 'invitations.errors.network';
  if (error.status === 401) return 'errors.unauthorized';
  if (error.status === 403) return 'invitations.errors.forbidden';
  if (error.status === 404) return 'invitations.errors.unavailable';
  if (error.status === 410) return 'invitations.errors.expired';
  if (error.status === 409) return 'invitations.errors.conflict';
  if (error.status === 429) return 'invitations.errors.rateLimit';
  if (error.status === 400) return 'invitations.errors.validation';
  return 'invitations.errors.network';
}
