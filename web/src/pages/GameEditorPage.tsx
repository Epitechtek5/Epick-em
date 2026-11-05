import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'

import { GameForm } from '@/components/games/GameForm'
import { StateMessage } from '@/components/games/StateMessage'
import { Button } from '@/components/ui/button'
import { createGame, getGame, updateGame } from '@/features/games/api'
import { gameErrorKey, isNameTaken } from '@/features/games/errors'
import type { GameField, GameValues } from '@/features/games/types'
import { changedGameFields, isGameId } from '@/features/games/validation'
import { useAsyncResource } from '@/hooks/use-async-resource'
import { useDocumentTitle } from '@/hooks/use-document-title'
import { useI18n, type MessageKey } from '@/i18n/context'
import { ApiError } from '@/lib/api/http'
import { useAuth } from '@/lib/auth/auth-context'

// Création (/games/new) et modification (/games/:id/edit), réservées aux admins.
export default function GameEditorPage() {
  const { id } = useParams()
  const editing = id !== undefined
  const { t } = useI18n()
  useDocumentTitle(editing ? t('games.edit') : t('games.create'))
  const navigate = useNavigate()
  const { refreshRole } = useAuth()
  const valid = !editing || isGameId(id)

  const { state, reload } = useAsyncResource(
    (signal) => {
      if (!editing) return Promise.resolve(null)
      return valid ? getGame(id, signal) : Promise.reject(new ApiError(404, undefined))
    },
    [id],
  )

  const [busy, setBusy] = useState(false)
  const [serverErrors, setServerErrors] = useState<Partial<Record<GameField, MessageKey>>>()
  const [formError, setFormError] = useState<MessageKey | null>(null)
  const [unchanged, setUnchanged] = useState(false)

  const cancel = () => navigate(editing ? `/games/${id}` : '/games')

  async function submit(values: GameValues) {
    setBusy(true)
    setServerErrors(undefined)
    setFormError(null)
    setUnchanged(false)
    try {
      if (editing && state.status === 'success' && state.data) {
        const changes = changedGameFields(state.data, values)
        if (Object.keys(changes).length === 0) {
          setUnchanged(true)
          return
        }
        const saved = await updateGame(state.data.id, changes)
        navigate(`/games/${saved.id}`, {
          replace: true,
          state: { notice: { key: 'games.updated', params: { name: saved.name } } },
        })
      } else {
        const created = await createGame({
          name: values.name.trim(),
          description: values.description,
          images: values.images,
        })
        navigate(`/games/${created.id}`, {
          replace: true,
          state: { notice: { key: 'games.created', params: { name: created.name } } },
        })
      }
    } catch (error) {
      if (isNameTaken(error)) setServerErrors({ name: 'games.errors.nameTaken' })
      else {
        // Un 403 laisse penser que le rôle a changé : on relit la session.
        if (error instanceof ApiError && error.status === 403) void refreshRole()
        setFormError(gameErrorKey(error))
      }
    } finally {
      setBusy(false)
    }
  }

  const title = editing ? t('games.edit') : t('games.create')

  return (
    <div className="grid w-full max-w-2xl gap-6 self-start">
      <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>

      {!valid ? (
        <StateMessage
          kind="error"
          action={
            <Link to="/games" className="text-primary underline underline-offset-4">
              {t('games.returnToCatalog')}
            </Link>
          }
        >
          {t('games.errors.invalidId')}
        </StateMessage>
      ) : null}

      {valid && state.status === 'loading' ? (
        <StateMessage kind="loading">{t('games.loadingDetails')}</StateMessage>
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
          {t(gameErrorKey(state.error))}
        </StateMessage>
      ) : null}

      {unchanged ? <StateMessage kind="empty">{t('games.noChanges')}</StateMessage> : null}

      {valid && state.status === 'success' ? (
        <GameForm
          key={state.data?.id ?? 'new'}
          initial={
            state.data
              ? { name: state.data.name, description: state.data.description, images: state.data.images }
              : undefined
          }
          submitLabel={editing ? t('common.save') : t('games.create')}
          busy={busy}
          serverErrors={serverErrors}
          formError={formError}
          onSubmit={submit}
          onCancel={cancel}
        />
      ) : null}
    </div>
  )
}
