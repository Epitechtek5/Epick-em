import { Add01Icon, ArrowLeft01Icon, Edit02Icon } from '@hugeicons/core-free-icons'
import { useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'

import { StateMessage } from '@/components/games/StateMessage'
import { TournamentForm } from '@/components/tournaments/TournamentForm'
import { TournamentPreview } from '@/components/tournaments/TournamentPreview'
import { TournamentStatusBadge } from '@/components/tournaments/TournamentStatusBadge'
import { PageHero } from '@/components/tournaments/ui'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { getGame, listAllGames } from '@/features/games/api'
import type { Game } from '@/features/games/types'
import { isUuid } from '@/features/teams/validation'
import { createTournament, getTournament, updateTournament } from '@/features/tournaments/api'
import { tournamentErrorKey, tournamentFieldErrors } from '@/features/tournaments/errors'
import { capacityLocked } from '@/features/tournaments/lifecycle'
import type { Tournament, TournamentFieldErrors, TournamentValues } from '@/features/tournaments/types'
import {
  changedTournamentFields,
  EMPTY_TOURNAMENT,
  toTournamentInput,
  tournamentValues,
} from '@/features/tournaments/validation'
import { useAsyncResource } from '@/hooks/use-async-resource'
import { useDocumentTitle } from '@/hooks/use-document-title'
import { useI18n, type MessageKey } from '@/i18n/context'
import { ApiError } from '@/lib/api/http'
import { useAuth } from '@/lib/auth/auth-context'

// Création (/tournaments/new, au statut brouillon) et modification (/tournaments/:id/edit) d'un
// tournoi, réservées aux administrateurs (AdminRoute ; le serveur reste juge).
export default function TournamentEditorPage() {
  const { id } = useParams()
  const editing = id !== undefined
  const { t } = useI18n()
  const title = editing ? t('tournaments.edit') : t('tournaments.create')
  useDocumentTitle(title)
  const navigate = useNavigate()
  const { refreshRole } = useAuth()
  const [search] = useSearchParams()
  const valid = !editing || isUuid(id)

  const { state, reload } = useAsyncResource<Tournament | Game[]>(
    (signal) => {
      if (editing) return valid ? getTournament(id, signal) : Promise.reject(new ApiError(404, undefined))
      return listAllGames(signal)
    },
    [id],
  )

  const [busy, setBusy] = useState(false)
  const [serverErrors, setServerErrors] = useState<TournamentFieldErrors>()
  const [formError, setFormError] = useState<MessageKey | null>(null)
  const [unchanged, setUnchanged] = useState(false)

  const tournament = editing && state.status === 'success' && !Array.isArray(state.data) ? state.data : null
  const games = !editing && state.status === 'success' && Array.isArray(state.data) ? state.data : null
  // Modification : jeu du tournoi pour l'aperçu (facultatif, une erreur ne bloque rien).
  const gameId = tournament?.game_id
  const { state: gameState } = useAsyncResource(
    (signal) => (gameId ? getGame(gameId, signal) : Promise.resolve(null)),
    [gameId],
  )
  const editedGame = gameState.status === 'success' ? gameState.data : null
  const previewGame = (gameIdValue: string) => {
    const game = games ? games.find((candidate) => candidate.id === gameIdValue) : editedGame
    return game ? { name: game.name, image: game.images[0] } : undefined
  }
  const cancel = () => navigate(editing ? `/tournaments/${id}` : '/tournaments')

  async function submit(values: TournamentValues) {
    setBusy(true)
    setServerErrors(undefined)
    setFormError(null)
    setUnchanged(false)
    try {
      if (tournament) {
        const changes = changedTournamentFields(tournament, values)
        if (Object.keys(changes).length === 0) {
          setUnchanged(true)
          return
        }
        const saved = await updateTournament(tournament.id, changes)
        navigate(`/tournaments/${saved.id}`, {
          replace: true,
          state: { notice: { key: 'tournaments.updated', params: { name: saved.name } } },
        })
      } else {
        const created = await createTournament(toTournamentInput(values))
        navigate(`/tournaments/${created.id}`, {
          replace: true,
          state: { notice: { key: 'tournaments.created', params: { name: created.name } } },
        })
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) void refreshRole()
      const fields = tournamentFieldErrors(error)
      if (fields) setServerErrors(fields)
      else setFormError(tournamentErrorKey(error))
    } finally {
      setBusy(false)
    }
  }

  const backLink = (
    <Link to="/tournaments" className="text-primary underline underline-offset-4 dark:text-violet-300">
      {t('tournaments.returnToCatalog')}
    </Link>
  )
  const presetGame = search.get('game') ?? ''
  const backTo = editing && valid ? `/tournaments/${id}` : '/tournaments'

  return (
    <div className="grid w-full max-w-6xl gap-6 self-start">
      <PageHero
        icon={editing ? Edit02Icon : Add01Icon}
        title={title}
        description={
          tournament ? (
            <span className="font-semibold text-white">{tournament.name}</span>
          ) : editing ? undefined : (
            t('tournaments.createIntro')
          )
        }
        back={
          <Link
            to={backTo}
            className="inline-flex items-center gap-1 font-medium text-white/90 underline underline-offset-4 hover:text-white"
          >
            <Icon icon={ArrowLeft01Icon} size={16} />
            {editing && valid ? t('tournaments.returnToTournament') : t('tournaments.returnToCatalog')}
          </Link>
        }
      >
        {tournament ? <TournamentStatusBadge status={tournament.status} className="shadow-sm" /> : null}
      </PageHero>

      {!valid ? (
        <StateMessage kind="error" action={backLink}>
          {t('tournaments.errors.invalidId')}
        </StateMessage>
      ) : null}

      {valid && state.status === 'loading' ? (
        <StateMessage kind="loading">
          {editing ? t('tournaments.loadingDetails') : t('tournaments.loadingGames')}
        </StateMessage>
      ) : null}

      {valid && state.status === 'error' ? (
        <StateMessage
          kind="error"
          action={
            <Button variant="outline" size="sm" onClick={reload}>
              {t('common.retry')}
            </Button>
          }
        >
          {t(tournamentErrorKey(state.error))}
        </StateMessage>
      ) : null}

      {games && games.length === 0 ? (
        <StateMessage kind="empty" action={backLink}>
          {t('tournaments.noGames')}
        </StateMessage>
      ) : null}

      {unchanged ? <StateMessage kind="empty">{t('tournaments.noChanges')}</StateMessage> : null}

      {tournament || (games && games.length > 0) ? (
        <TournamentForm
          key={tournament?.id ?? 'new'}
          initial={
            tournament
              ? tournamentValues(tournament)
              : {
                  ...EMPTY_TOURNAMENT,
                  game_id: games?.some((game) => game.id === presetGame) ? presetGame : '',
                }
          }
          games={games ?? undefined}
          capacityLocked={tournament ? capacityLocked(tournament.status) : false}
          submitLabel={tournament ? t('common.save') : t('tournaments.create')}
          busy={busy}
          serverErrors={serverErrors}
          formError={formError}
          onSubmit={submit}
          onCancel={cancel}
          preview={(values) => (
            <TournamentPreview
              values={values}
              status={tournament?.status ?? 'draft'}
              game={previewGame(values.game_id)}
              creating={!tournament}
            />
          )}
        />
      ) : null}
    </div>
  )
}
