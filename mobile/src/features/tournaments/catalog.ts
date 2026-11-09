import {
  getTournamentTeam,
  listTournamentTeamMembers,
} from '@/features/teams/api';
import { listParticipants, listTournaments } from './api';
import type { ParticipantType, Tournament, TournamentStatus } from './types';

const SCAN_PAGE_SIZE = 100;
export const TOURNAMENT_SCAN_LIMIT = 1000;

export interface TournamentFilters {
  name: string;
  gameId?: string;
  status?: TournamentStatus;
  participantType?: ParticipantType;
  startsAfter?: string | null;
  startsBefore?: string | null;
  registrationClosesAfter?: string | null;
  registrationClosesBefore?: string | null;
  registeredUserId?: string;
}

export function hasAdvancedTournamentFilters(filters: TournamentFilters) {
  return Boolean(
    filters.name.trim() ||
    filters.participantType ||
    filters.startsAfter ||
    filters.startsBefore ||
    filters.registrationClosesAfter ||
    filters.registrationClosesBefore ||
    filters.registeredUserId,
  );
}

function inRange(
  value: string | null,
  after?: string | null,
  before?: string | null,
) {
  if (!after && !before) return true;
  if (!value) return false;
  const time = Date.parse(value);
  return (
    (!after || time >= Date.parse(after)) &&
    (!before || time <= Date.parse(before))
  );
}

export function filterTournaments(
  tournaments: Tournament[],
  filters: TournamentFilters,
  registeredIds: ReadonlySet<string> = new Set(),
) {
  const name = filters.name.trim().toLocaleLowerCase();
  return tournaments.filter(
    (tournament) =>
      (!name || tournament.name.toLocaleLowerCase().includes(name)) &&
      (!filters.participantType ||
        tournament.participant_type === filters.participantType) &&
      inRange(
        tournament.start_date,
        filters.startsAfter,
        filters.startsBefore,
      ) &&
      inRange(
        tournament.registration_close_at,
        filters.registrationClosesAfter,
        filters.registrationClosesBefore,
      ) &&
      (!filters.registeredUserId || registeredIds.has(tournament.id)),
  );
}

export async function listAllTournamentParticipants(
  token: string,
  tournamentId: string,
) {
  const participants: Awaited<ReturnType<typeof listParticipants>> = [];
  for (let offset = 0; ; offset += SCAN_PAGE_SIZE) {
    const page = await listParticipants(
      token,
      tournamentId,
      SCAN_PAGE_SIZE,
      offset,
    );
    participants.push(...page);
    if (page.length < SCAN_PAGE_SIZE) return participants;
  }
}

async function isUserRegistered(
  token: string,
  tournament: Tournament,
  userId: string,
) {
  const participants = await listAllTournamentParticipants(
    token,
    tournament.id,
  );
  const active = participants.filter(
    (participant) =>
      participant.status === 'registered' ||
      participant.status === 'checked_in',
  );
  if (active.some((participant) => participant.user_id === userId)) return true;
  if (tournament.participant_type !== 'team') return false;

  for (const participant of active) {
    if (!participant.tournament_team_id) continue;
    try {
      const team = await getTournamentTeam(
        token,
        participant.tournament_team_id,
      );
      if (team.owner_id === userId) return true;
      const members = await listTournamentTeamMembers(token, team.id);
      if (members.some((member) => member.user_id === userId)) return true;
    } catch {
      // A removed team cannot establish current ownership.
    }
  }
  return false;
}

export async function loadFilteredTournamentCatalog(
  token: string,
  filters: TournamentFilters,
) {
  const tournaments: Tournament[] = [];
  let reachedEnd = false;
  for (
    let offset = 0;
    offset < TOURNAMENT_SCAN_LIMIT;
    offset += SCAN_PAGE_SIZE
  ) {
    const page = await listTournaments(token, {
      game_id: filters.gameId,
      status: filters.status,
      limit: SCAN_PAGE_SIZE,
      offset,
    });
    tournaments.push(...page);
    if (page.length < SCAN_PAGE_SIZE) {
      reachedEnd = true;
      break;
    }
  }

  if (!reachedEnd) {
    const next = await listTournaments(token, {
      game_id: filters.gameId,
      status: filters.status,
      limit: 1,
      offset: TOURNAMENT_SCAN_LIMIT,
    });
    reachedEnd = next.length === 0;
  }
  const complete = reachedEnd;
  const registeredIds = new Set<string>();
  if (filters.registeredUserId) {
    for (const tournament of tournaments) {
      if (await isUserRegistered(token, tournament, filters.registeredUserId)) {
        registeredIds.add(tournament.id);
      }
    }
  }

  return {
    tournaments: filterTournaments(tournaments, filters, registeredIds),
    complete,
  };
}
