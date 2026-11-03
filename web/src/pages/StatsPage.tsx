import { Add01Icon, ArrowLeft01Icon, ArrowRight01Icon, Download04Icon, Edit02Icon, RefreshIcon } from '@hugeicons/core-free-icons'
import { useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router'

import { ConfirmDeleteDialog } from '@/components/common/ConfirmDeleteDialog'
import { StateMessage } from '@/components/games/StateMessage'
import { Button, buttonVariants } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { deleteStat, listStats } from '@/features/stats/api'
import { statErrorKey } from '@/features/stats/errors'
import { statTypeLabelKey } from '@/features/stats/labels'
import type { Stat } from '@/features/stats/types'
import { readNotice, type Notice } from '@/features/games/notice'
import { useAsyncResource } from '@/hooks/use-async-resource'
import { useDocumentTitle } from '@/hooks/use-document-title'
import { useI18n, type MessageKey } from '@/i18n/context'
import { ApiError } from '@/lib/api/http'
import { useAuth } from '@/lib/auth/auth-context'

const PAGE_SIZE = 12

function readPage(raw: string | null): number {
  const page = Number.parseInt(raw ?? '1', 10)
  return Number.isFinite(page) && page >= 1 ? page : 1
}

// Catalogue : GET /stats?limit=&offset=, ordre alphabétique fourni par le serveur.
// Lecture seule pour user et watcher ; création, modification, suppression, import et
// export pour les administrateurs.
export default function StatsPage() {
  const { t } = useI18n()
  useDocumentTitle(t('stats.title'))
  const { isAdmin, refreshRole } = useAuth()
  const location = useLocation()
  const [params, setParams] = useSearchParams()
  const page = readPage(params.get('page'))
  const [localNotice, setLocalNotice] = useState<Notice | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<MessageKey | null>(null)
  const notice = localNotice ?? readNotice(location.state)

  const { state, reload } = useAsyncResource(
    (signal) => listStats({ limit: PAGE_SIZE + 1, offset: (page - 1) * PAGE_SIZE }, signal),
    [page],
  )

  const goTo = (target: number) => setParams(target <= 1 ? {} : { page: String(target) })

  async function remove(stat: Stat) {
    setDeletingId(stat.id)
    setDeleteError(null)
    setLocalNotice(null)
    try {
      await deleteStat(stat.id)
      setLocalNotice({ key: 'stats.deleted', params: { name: stat.name } })
      reload()
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) void refreshRole()
      setDeleteError(statErrorKey(error))
    } finally {
      setDeletingId(null)
    }
  }

  const stats = state.status === 'success' ? state.data.slice(0, PAGE_SIZE) : []
  const hasNext = state.status === 'success' && state.data.length > PAGE_SIZE

  return (
    <div className="grid w-full max-w-5xl gap-6 self-start">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">{t('stats.title')}</h1>
          <p className="text-muted-foreground">{t('stats.description')}</p>
        </div>
        <div
          className="flex flex-wrap gap-2 sm:flex-nowrap"
          role="group"
          aria-label={isAdmin ? t('stats.adminActions') : t('stats.title')}
        >
          <Button variant="outline" onClick={reload} disabled={state.status === 'loading'}>
            <Icon icon={RefreshIcon} />
            {t('stats.refresh')}
          </Button>
          {isAdmin ? (
            <>
              <Link to="/stats/transfer" className={buttonVariants({ variant: 'outline' })}>
                <Icon icon={Download04Icon} />
                {t('stats.transfer')}
              </Link>
              <Link to="/stats/new" className={buttonVariants()}>
                <Icon icon={Add01Icon} />
                {t('stats.create')}
              </Link>
            </>
          ) : null}
        </div>
      </div>

      {notice ? <StateMessage kind="success">{t(notice.key, notice.params)}</StateMessage> : null}
      {deleteError ? <StateMessage kind="error">{t(deleteError)}</StateMessage> : null}

      {state.status === 'loading' ? (
        <StateMessage kind="loading">{t('stats.loading')}</StateMessage>
      ) : null}

      {state.status === 'error' ? (
        <StateMessage
          kind="error"
          action={
            state.error instanceof ApiError && state.error.status === 401 ? undefined : (
              <Button variant="outline" size="sm" onClick={reload}>
                {t('common.retry')}
              </Button>
            )
          }
        >
          {t(statErrorKey(state.error))}
        </StateMessage>
      ) : null}

      {state.status === 'success' && stats.length === 0 ? (
        <StateMessage kind="empty">
          {isAdmin && page === 1 ? t('stats.emptyAdmin') : t('stats.empty')}
        </StateMessage>
      ) : null}

      {stats.length > 0 ? (
        <ul aria-label={t('stats.list')} className="grid gap-3">
          {stats.map((stat) => (
            <li
              key={stat.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-card p-4 text-card-foreground ring-1 ring-foreground/10"
            >
              <div className="grid gap-1">
                <h2 className="text-base font-semibold">{stat.name}</h2>
                <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                  <span>
                    <span className="sr-only">{t('stats.key')} : </span>
                    <code className="font-mono">{stat.key}</code>
                  </span>
                  <span>
                    <span className="sr-only">{t('stats.type')} : </span>
                    {t(statTypeLabelKey(stat.type))} ({stat.type})
                  </span>
                </p>
              </div>
              {isAdmin ? (
                <div className="flex flex-wrap gap-2">
                  <Link
                    to={`/stats/${stat.id}/edit`}
                    aria-label={t('stats.editAction', { name: stat.name })}
                    className={buttonVariants({ variant: 'outline', size: 'sm' })}
                  >
                    <Icon icon={Edit02Icon} />
                    {t('stats.edit')}
                  </Link>
                  <ConfirmDeleteDialog
                    size="sm"
                    label={t('stats.delete')}
                    busyLabel={t('stats.deleting')}
                    triggerAriaLabel={t('stats.deleteAction', { name: stat.name })}
                    title={t('stats.confirmDeleteTitle')}
                    description={t('stats.confirmDelete', { name: stat.name })}
                    busy={deletingId === stat.id}
                    onConfirm={() => remove(stat)}
                  />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {state.status === 'success' && (page > 1 || hasNext) ? (
        <nav aria-label={t('games.pagination')} className="flex items-center justify-between gap-3">
          <Button variant="outline" disabled={page <= 1} onClick={() => goTo(page - 1)}>
            <Icon icon={ArrowLeft01Icon} />
            {t('games.previous')}
          </Button>
          <span className="text-sm text-muted-foreground" aria-current="page">
            {t('games.page', { page })}
          </span>
          <Button variant="outline" disabled={!hasNext} onClick={() => goTo(page + 1)}>
            {t('games.next')}
            <Icon icon={ArrowRight01Icon} />
          </Button>
        </nav>
      ) : null}
    </div>
  )
}
