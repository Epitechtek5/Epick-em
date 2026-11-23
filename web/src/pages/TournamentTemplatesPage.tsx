import { Add01Icon, ArrowLeft01Icon, RefreshIcon, Task01Icon } from '@hugeicons/core-free-icons'
import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'

import { ConfirmDeleteDialog } from '@/components/common/ConfirmDeleteDialog'
import { StateMessage } from '@/components/games/StateMessage'
import { CopyTournamentDialog } from '@/components/tournaments/CopyTournamentDialog'
import { EmptyState, PageHero, SectionCard } from '@/components/tournaments/ui'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { readNotice } from '@/features/games/notice'
import { listAllGames } from '@/features/games/api'
import { createFromTemplate, deleteTemplate, listTemplates } from '@/features/tournaments/api'
import { tournamentErrorKey } from '@/features/tournaments/errors'
import { teamFormatMessage } from '@/features/tournaments/format'
import { modeLabelKey, participantTypeLabelKey, policyLabelKey, visibilityLabelKey } from '@/features/tournaments/labels'
import type { Tournament } from '@/features/tournaments/types'
import { useAsyncResource } from '@/hooks/use-async-resource'
import { useDocumentTitle } from '@/hooks/use-document-title'
import { useI18n, type MessageKey } from '@/i18n/context'

// Modèles de tournoi (/tournament-templates, administrateurs globaux) : configuration
// réutilisable (réglages, champs d'inscription, barème, étapes), jamais ouverte aux
// inscriptions. On en crée un tournoi brouillon, ou on supprime le modèle.
export default function TournamentTemplatesPage() {
  const { t } = useI18n()
  useDocumentTitle(t('tournaments.templates.title'))
  const navigate = useNavigate()
  const notice = readNotice(useLocation().state)
  const { state, reload } = useAsyncResource((signal) => listTemplates({ limit: 100 }, signal), [])
  const games = useAsyncResource((signal) => listAllGames(signal), [])
  const gameName = (id: string) =>
    games.state.status === 'success' ? (games.state.data.find((game) => game.id === id)?.name ?? t('teams.unknownGame')) : '…'
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<MessageKey | null>(null)
  const [deleted, setDeleted] = useState<string | null>(null)

  async function remove(template: Tournament) {
    setBusy(template.id)
    setError(null)
    setDeleted(null)
    try {
      await deleteTemplate(template.id)
      setDeleted(template.name)
      reload()
    } catch (caught) {
      setError(tournamentErrorKey(caught))
    } finally {
      setBusy(null)
    }
  }

  const templates = state.status === 'success' ? state.data : []

  return (
    <div className="grid w-full max-w-6xl gap-6 self-start">
      <PageHero
        icon={Task01Icon}
        title={t('tournaments.templates.title')}
        description={t('tournaments.templates.intro')}
        back={
          <Link
            to="/tournaments"
            className="inline-flex items-center gap-1 font-medium text-white/90 underline underline-offset-4 hover:text-white"
          >
            <Icon icon={ArrowLeft01Icon} size={16} />
            {t('tournaments.returnToCatalog')}
          </Link>
        }
      />

      {notice ? <StateMessage kind="success">{t(notice.key, notice.params)}</StateMessage> : null}
      {deleted ? <StateMessage kind="success">{t('tournaments.templates.deleted', { name: deleted })}</StateMessage> : null}
      {error ? <StateMessage kind="error">{t(error)}</StateMessage> : null}

      <SectionCard
        id="templates-title"
        icon={Task01Icon}
        title={t('tournaments.templates.listTitle')}
        subtitle={t('tournaments.templates.hint')}
        actions={
          <Button variant="outline" size="sm" onClick={reload} disabled={state.status === 'loading'}>
            <Icon icon={RefreshIcon} />
            {t('tournaments.templates.refresh')}
          </Button>
        }
      >
        {state.status === 'loading' ? <StateMessage kind="loading">{t('tournaments.templates.loading')}</StateMessage> : null}
        {state.status === 'error' ? (
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
        {state.status === 'success' && templates.length === 0 ? (
          <EmptyState icon={Task01Icon}>{t('tournaments.templates.empty')}</EmptyState>
        ) : null}
        {templates.length > 0 ? (
          <ul aria-label={t('tournaments.templates.list')} className="grid gap-3">
            {templates.map((template) => {
              const format = teamFormatMessage(template.team_min_starters, template.team_max_starters)
              return (
                <li key={template.id} className="grid gap-3 rounded-xl p-4 ring-1 ring-foreground/10">
                  <div className="grid gap-1">
                    <h3 className="text-base font-semibold break-words">{template.name}</h3>
                    <p className="text-sm text-muted-foreground">
                      {gameName(template.game_id)} ·{' '}
                      {format ? t(format.key, format.params) : t(participantTypeLabelKey(template.participant_type))} ·{' '}
                      {t(modeLabelKey(template.mode))} · {t(visibilityLabelKey(template.visibility))} ·{' '}
                      {t(policyLabelKey(template.registration_policy))}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {t('tournaments.templates.fieldsCount', { count: template.registration_fields.length })}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <CopyTournamentDialog
                      source={template}
                      idPrefix={`from-template-${template.id}`}
                      icon={Add01Icon}
                      variant="default"
                      label={t('tournaments.templates.use')}
                      title={t('tournaments.templates.useTitle', { name: template.name })}
                      description={t('tournaments.templates.useHint')}
                      submitLabel={t('tournaments.templates.useSubmit')}
                      defaultName={template.name}
                      onCopy={async (input) => {
                        const created = await createFromTemplate(template.id, input)
                        navigate(`/tournaments/${created.id}`, {
                          state: { notice: { key: 'tournaments.templates.created', params: { name: created.name } } },
                        })
                      }}
                    />
                    <ConfirmDeleteDialog
                      size="sm"
                      label={t('tournaments.templates.delete')}
                      busyLabel={t('tournaments.deleting')}
                      triggerAriaLabel={t('tournaments.templates.deleteFor', { name: template.name })}
                      title={t('tournaments.templates.confirmDeleteTitle')}
                      description={t('tournaments.templates.confirmDelete', { name: template.name })}
                      busy={busy === template.id}
                      onConfirm={() => void remove(template)}
                    />
                  </div>
                </li>
              )
            })}
          </ul>
        ) : null}
      </SectionCard>
    </div>
  )
}
