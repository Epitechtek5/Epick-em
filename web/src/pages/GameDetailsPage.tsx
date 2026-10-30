import { ArrowLeft01Icon, Edit02Icon, RefreshIcon } from '@hugeicons/core-free-icons'
import { useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'

import { DeleteGameDialog } from '@/components/games/DeleteGameDialog'
import { GameImage } from '@/components/games/GameImage'
import { StateMessage } from '@/components/games/StateMessage'
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
    <Link to="/games" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
      <Icon icon={ArrowLeft01Icon} />
      {t('games.returnToCatalog')}
    </Link>
  )

  if (!valid) {
    return (
      <div className="grid w-full max-w-5xl gap-4 self-start">
        <h1 className="text-3xl font-semibold tracking-tight">{t('games.details')}</h1>
        <StateMessage kind="error" action={back}>{t('games.errors.invalidId')}</StateMessage>
      </div>
    )
  }

  const images = game?.images ?? []
  const primary = images[selected] ?? images[0]

  return (
    <div className="grid w-full max-w-5xl gap-6 self-start">
      <div>{back}</div>

      {notice ? <StateMessage kind="success">{t(notice.key, notice.params)}</StateMessage> : null}

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
        <article className="grid gap-6 lg:grid-cols-2" aria-labelledby="game-title">
          <div className="grid content-start gap-3">
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
          </div>

          <div className="grid content-start gap-4">
            <h1 id="game-title" className="text-3xl font-semibold tracking-tight">
              {game.name}
            </h1>
            <p className="whitespace-pre-line text-muted-foreground">
              {game.description || t('games.noDescription')}
            </p>
            <dl className="text-sm">
              <dt className="font-medium">{t('games.identifier')}</dt>
              <dd className="break-all font-mono text-muted-foreground">{game.id}</dd>
            </dl>

            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={reload}>
                <Icon icon={RefreshIcon} />
                {t('games.refresh')}
              </Button>
              {isAdmin ? (
                <>
                  <Link to={`/games/${game.id}/edit`} className={buttonVariants({ variant: 'outline' })}>
                    <Icon icon={Edit02Icon} />
                    {t('games.edit')}
                  </Link>
                  <DeleteGameDialog name={game.name} busy={deleting} onConfirm={remove} />
                </>
              ) : null}
            </div>
            {deleteError ? <StateMessage kind="error">{t(deleteError)}</StateMessage> : null}
          </div>
        </article>
      ) : null}
    </div>
  )
}
