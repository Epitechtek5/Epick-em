import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'

import { StateMessage } from '@/components/games/StateMessage'
import { StatForm } from '@/components/stats/StatForm'
import { Button } from '@/components/ui/button'
import { createStat, getStat, updateStat } from '@/features/stats/api'
import { isKeyTaken, statErrorKey } from '@/features/stats/errors'
import type { StatField, StatInput } from '@/features/stats/types'
import { changedStatFields, statId } from '@/features/stats/validation'
import { useAsyncResource } from '@/hooks/use-async-resource'
import { useDocumentTitle } from '@/hooks/use-document-title'
import { useI18n, type MessageKey } from '@/i18n/context'
import { ApiError } from '@/lib/api/http'
import { useAuth } from '@/lib/auth/auth-context'

function isValidId(id: string): boolean {
  try {
    statId(id)
    return true
  } catch {
    return false
  }
}

// Création (/stats/new) et modification (/stats/:id/edit), réservées aux admins.
export default function StatEditorPage() {
  const { id } = useParams()
  const editing = id !== undefined
  const { t } = useI18n()
  useDocumentTitle(editing ? t('stats.edit') : t('stats.create'))
  const navigate = useNavigate()
  const { refreshRole } = useAuth()
  const valid = !editing || isValidId(id)

  const { state, reload } = useAsyncResource(
    (signal) => {
      if (!editing) return Promise.resolve(null)
      return valid ? getStat(id, signal) : Promise.reject(new ApiError(404, undefined))
    },
    [id],
  )

  const [busy, setBusy] = useState(false)
  const [serverErrors, setServerErrors] = useState<Partial<Record<StatField, MessageKey>>>()
  const [formError, setFormError] = useState<MessageKey | null>(null)
  const [unchanged, setUnchanged] = useState(false)

  async function submit(values: StatInput) {
    setBusy(true)
    setServerErrors(undefined)
    setFormError(null)
    setUnchanged(false)
    const trimmed = { ...values, name: values.name.trim(), key: values.key.trim() }
    try {
      if (editing && state.status === 'success' && state.data) {
        const changes = changedStatFields(state.data, trimmed)
        if (Object.keys(changes).length === 0) {
          setUnchanged(true)
          return
        }
        const saved = await updateStat(state.data.id, changes)
        navigate('/stats', {
          replace: true,
          state: { notice: { key: 'stats.updated', params: { name: saved.name } } },
        })
      } else {
        const created = await createStat(trimmed)
        navigate('/stats', {
          replace: true,
          state: { notice: { key: 'stats.created', params: { name: created.name } } },
        })
      }
    } catch (error) {
      if (isKeyTaken(error)) setServerErrors({ key: 'stats.errors.keyTaken' })
      else {
        // Un 403 laisse penser que le rôle a changé : on relit la session.
        if (error instanceof ApiError && error.status === 403) void refreshRole()
        setFormError(statErrorKey(error))
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid w-full max-w-2xl gap-6 self-start">
      <h1 className="text-3xl font-semibold tracking-tight">
        {editing ? t('stats.edit') : t('stats.create')}
      </h1>

      {!valid ? (
        <StateMessage
          kind="error"
          action={
            <Link to="/stats" className="text-primary underline underline-offset-4">
              {t('stats.returnToCatalog')}
            </Link>
          }
        >
          {t('stats.errors.invalidId')}
        </StateMessage>
      ) : null}

      {valid && state.status === 'loading' ? (
        <StateMessage kind="loading">{t('stats.loadingDetails')}</StateMessage>
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
          {t(statErrorKey(state.error))}
        </StateMessage>
      ) : null}

      {unchanged ? <StateMessage kind="empty">{t('stats.noChanges')}</StateMessage> : null}

      {valid && state.status === 'success' ? (
        <StatForm
          key={state.data?.id ?? 'new'}
          initial={
            state.data
              ? { name: state.data.name, key: state.data.key, type: state.data.type }
              : undefined
          }
          submitLabel={editing ? t('common.save') : t('stats.create')}
          busy={busy}
          serverErrors={serverErrors}
          formError={formError}
          onSubmit={submit}
          onCancel={() => navigate('/stats')}
        />
      ) : null}
    </div>
  )
}
