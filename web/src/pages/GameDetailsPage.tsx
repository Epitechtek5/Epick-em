import {
  ArrowLeft01Icon,
  Edit02Icon,
  GameController01Icon,
  Image01Icon,
  InformationCircleIcon,
  RefreshIcon,
} from '@hugeicons/core-free-icons'
import { useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'

import { FactTile, HERO_ACTION, HERO_BACK, PageHero, SectionCard } from '@/components/common/page-blocks'
import { DeleteGameDialog } from '@/components/games/DeleteGameDialog'
import { GameImage } from '@/components/games/GameImage'
import { StateMessage } from '@/components/games/StateMessage'
import { GameStatsSection } from '@/components/stats/GameStatsSection'
import { Button, buttonVariants } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { deleteGame, getGame } from '@/features/games/api'
import { gameErrorKey } from '@/features/games/errors'
import { readNotice } from '@/features/games/notice'
import { isGameId } from '@/features/games/validation'
import { useAsyncResource } from '@/hooks/use-async-resource'
import { useDocumentTitle } from '@/hooks/use-document-title'
import { useI18n, type MessageKey } from '@/i18n/context'
import { ApiError } from '@/lib/api/http'
import { useAuth } from '@/lib/auth/auth-context'
import { cn } from '@/lib/utils'

export default function GameDetailsPage() {
  const { id = '' } = useParams()
  const { t } = useI18n()
  const { isAdmin, refreshRole } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const notice = readNotice(location.state)
  const valid = isGameId(id)

  const { state, reload } = useAsyncResource(
    (signal) => (valid ? getGame(id, signal) : Promise.reject(new ApiError(404, undefined))),
    [id],
  )
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<MessageKey | null>(null)
  const [selected, setSelected] = useState(0)

  const game = state.status === 'success' ? state.data : null
  useDocumentTitle(game?.name ?? t('games.details'))

  async function remove() {
    if (!game) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await deleteGame(game.id)
      navigate('/games', {
        replace: true,
        state: { notice: { key: 'games.deleted', params: { name: game.name } } },
      })
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) void refreshRole()
      setDeleteError(gameErrorKey(error))
      setDeleting(false)
    }
  }

  const back = (
    <Link to="/games" className={HERO_BACK}>
      <Icon icon={ArrowLeft01Icon} size={16} />
      {t('games.returnToCatalog')}
    </Link>
  )

  if (!valid) {
    return (
      <div className="grid w-full max-w-6xl gap-6 self-start">
        <PageHero icon={GameController01Icon} title={t('games.details')} back={back} />
        <StateMessage kind="error">{t('games.errors.invalidId')}</StateMessage>
      </div>
    )
  }

  const images = game?.images ?? []
  const primary = images[selected] ?? images[0]

  return (
    <div className="grid w-full max-w-6xl gap-6 self-start">
      <PageHero
        icon={GameController01Icon}
        title={game?.name ?? t('games.details')}
        description={game ? <p className="whitespace-pre-line">{game.description || t('games.noDescription')}</p> : undefined}
        back={back}
      >
        {game ? (
          <div className="flex flex-wrap gap-2" role="group" aria-label={t('games.adminActions')}>
            <Button variant="outline" className={HERO_ACTION} onClick={reload}>
              <Icon icon={RefreshIcon} />
              {t('games.refresh')}
            </Button>
            {isAdmin ? (
              <>
                <Link to={`/games/${game.id}/edit`} className={cn(buttonVariants({ variant: 'outline' }), HERO_ACTION)}>
                  <Icon icon={Edit02Icon} />
                  {t('games.edit')}
                </Link>
                <DeleteGameDialog name={game.name} busy={deleting} onConfirm={remove} />
              </>
            ) : null}
          </div>
        ) : null}
      </PageHero>

      {notice ? <StateMessage kind="success">{t(notice.key, notice.params)}</StateMessage> : null}
      {deleteError ? <StateMessage kind="error">{t(deleteError)}</StateMessage> : null}

      {state.status === 'loading' ? (
        <StateMessage kind="loading">{t('games.loadingDetails')}</StateMessage>
      ) : null}

      {state.status === 'error' ? (
        <StateMessage
          kind="error"
          action={
            <Button variant="outline" size="sm" onClick={reload}>
              {t('common.retry')}
            </Button>
          }
        >
          {t(gameErrorKey(state.error))}
        </StateMessage>
      ) : null}

      {game ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <SectionCard id="game-gallery" icon={Image01Icon} title={t('games.images')}>
            <GameImage key={primary} src={primary} name={game.name} className="rounded-xl" />
            {images.length > 1 ? (
              <ul className="flex flex-wrap gap-2" aria-label={t('games.gallery')}>
                {images.map((src, index) => (
                  <li key={`${src}-${index}`}>
                    <button
                      type="button"
                      aria-label={t('games.imageNumber', { number: index + 1 })}
                      aria-pressed={index === selected}
                      onClick={() => setSelected(index)}
                      className="block size-16 overflow-hidden rounded-lg outline-none ring-1 ring-foreground/10 focus-visible:ring-3 focus-visible:ring-ring aria-pressed:ring-2 aria-pressed:ring-primary"
                    >
                      <GameImage src={src} name={game.name} className="size-16 aspect-square" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </SectionCard>
          <dl className="grid content-start gap-3">
            <FactTile icon={InformationCircleIcon} label={t('games.identifier')}>
              <span className="font-mono font-normal break-all">{game.id}</span>
            </FactTile>
            <FactTile icon={Image01Icon} label={t('games.images')}>
              {images.length}
            </FactTile>
          </dl>
        </div>
      ) : null}

      {game ? <GameStatsSection gameId={game.id} /> : null}
    </div>
  )
}
