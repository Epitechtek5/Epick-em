import { authenticatedRequest, ApiError } from '@/lib/api';
import { authenticatedHeaders } from '@/features/users/api';

export type Capabilities = Partial<
  Record<
    | 'search'
    | 'url_resolution'
    | 'phases'
    | 'groups'
    | 'matches'
    | 'games'
    | 'characters'
    | 'stages'
    | 'seeds'
    | 'standings'
    | 'incremental_sync',
    boolean
  >
>;
export interface Connector {
  id: string;
  display_name: string;
  capabilities: Capabilities;
}
export interface ExternalReference {
  provider: string;
  external_id: string;
  name: string;
  url: string | null;
  starts_at: number | null;
  ends_at: number | null;
}
export interface ExternalEventReference {
  external_id: string;
  name: string;
  game: string | null;
  url: string | null;
  starts_at: number | null;
  state: 'created' | 'active' | 'completed';
  entrant_count: number | null;
}
export interface ExternalMatch {
  external_id: string;
  phase_id: string | null;
  group_id: string | null;
  round: number | null;
  round_label: string | null;
  state: 'pending' | 'in_progress' | 'completed';
  slots: { entrant_id: string | null; score: number | null }[];
  winner_entrant_id: string | null;
  forfeit: boolean;
  games: {
    external_id: string | null;
    order: number;
    winner_entrant_id: string | null;
    stage: string | null;
    selections: { entrant_id: string; character: string | null }[];
  }[];
}
export interface ExternalEvent extends ExternalEventReference {
  phases: {
    external_id: string;
    name: string;
    format: string | null;
    groups: { external_id: string; label: string | null }[];
  }[];
  entrants: { external_id: string; name: string; seed: number | null }[];
  standings: { entrant_id: string; placement: number }[];
  matches: ExternalMatch[];
}
export interface TournamentSource {
  id: string;
  provider: string;
  provider_name: string;
  url: string | null;
  last_success_at: string | null;
  stale: boolean;
  capabilities: Capabilities;
  snapshot: (ExternalReference & { events: ExternalEvent[] }) | null;
}
export interface ExternalImport extends Omit<
  TournamentSource,
  'provider_name' | 'snapshot'
> {
  snapshot?: TournamentSource['snapshot'];
  name: string;
  tournament_id: string | null;
  event_ids: string[];
}
export interface ResolvedTournament {
  tournament: ExternalReference;
  events: ExternalEventReference[];
  already_imported: string | null;
}

export function externalApi(token: string) {
  function request<T>(
    path: string,
    method = 'GET',
    body?: unknown,
    signal?: AbortSignal,
  ) {
    return authenticatedRequest<T>(path, {
      method,
      ...(signal ? { signal } : {}),
      headers: authenticatedHeaders(token),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  return {
    connectors: () => request<Connector[]>('/connectors'),
    search: (provider: string, query: string) =>
      request<ExternalReference[]>(
        `/connectors/${encodeURIComponent(provider)}/tournaments?q=${encodeURIComponent(query.trim())}`,
      ),
    resolve: (url: string) =>
      request<ResolvedTournament>('/connectors/resolve', 'POST', {
        url: url.trim(),
      }),
    import: async (body: {
      url: string;
      game_id: string;
      event_ids: string[];
    }) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 45_000);
      try {
        return await request<ExternalImport>(
          '/external-tournaments?background=true',
          'POST',
          body,
          controller.signal,
        );
      } catch (error) {
        if (controller.signal.aborted)
          throw new ApiError(
            408,
            'Import response timed out',
            'import_timeout',
          );
        throw error;
      } finally {
        clearTimeout(timer);
      }
    },
    list: () => request<ExternalImport[]>('/external-tournaments'),
    sync: (id: string) =>
      request<ExternalImport>(
        `/external-tournaments/${encodeURIComponent(id)}/sync`,
        'POST',
      ),
    remove: (id: string) =>
      request<void>(
        `/external-tournaments/${encodeURIComponent(id)}`,
        'DELETE',
      ),
    source: async (id: string, details = true) => {
      try {
        return await request<TournamentSource>(
          `/tournaments/${encodeURIComponent(id)}/source${details ? '?details=true' : ''}`,
        );
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },
  };
}

export function externalError(error: unknown) {
  if (!(error instanceof ApiError)) return 'errors.network';
  if (error.code === 'import_timeout') return 'external.importTimeout';
  if (error.code === 'already_imported') return 'external.alreadyImported';
  if (error.code === 'sync_in_progress') return 'external.syncBusy';
  if (error.code === 'external_unavailable' || error.status === 503)
    return 'external.unavailable';
  if (error.code === 'externally_managed') return 'external.readOnly';
  if (error.status === 401) return 'errors.unauthorized';
  if (error.status === 403) return 'errors.forbidden';
  if (error.status === 404) return 'external.notFound';
  if (error.status === 400) return 'external.invalid';
  if (error.status === 409) return 'external.conflict';
  return 'errors.server';
}

export function safeSourceUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
