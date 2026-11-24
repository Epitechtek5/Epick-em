import {
  Add01Icon,
  Alert02Icon,
  Delete02Icon,
  Edit02Icon,
  RefreshIcon,
  RepeatIcon,
} from '@hugeicons/core-free-icons'
import type { IconSvgElement } from '@hugeicons/react'
import { useEffect, useId, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { matchStatusLabelKey, resultLabelKey } from '@/features/matches/labels'
import type { MatchResult, MatchStatus } from '@/features/matches/types'
import { stepParticipantStatusLabelKey, stepStatusLabelKey } from '@/features/steps/labels'
import type { StepParticipantStatus, StepStatus } from '@/features/steps/types'
import type {
  ImportChangeAction,
  ImportMatchPreview,
  ImportResourceChange,
  ImportStepPreview,
  ImportTournamentChanges,
  TournamentImportPreview,
} from '@/features/tournaments/import-preview'
import type { PreviewState } from '@/hooks/use-transfer'
import { useI18n, type MessageKey } from '@/i18n/context'
import { cn } from '@/lib/utils'

// Matchs affichés par étape avant « Afficher plus » : un gros fichier reste lisible.
const MATCH_PAGE = 10

const ACTIONS: ImportChangeAction[] = ['create', 'update', 'replace', 'delete']

const ACTION_ICON: Record<ImportChangeAction, IconSvgElement> = {
  create: Add01Icon,
  update: Edit02Icon,
  replace: RepeatIcon,
  delete: Delete02Icon,
}

const ACTION_KEY: Record<ImportChangeAction, MessageKey> = {
  create: 'importPreview.actions.create',
  update: 'importPreview.actions.update',
  replace: 'importPreview.actions.replace',
  delete: 'importPreview.actions.delete',
}

const RESOURCE_KEY: Record<string, MessageKey> = {
  tournament: 'importPreview.resources.tournament',
  scoring_rules: 'importPreview.resources.scoring_rules',
  participants: 'importPreview.resources.participants',
  teams: 'importPreview.resources.teams',
  steps: 'importPreview.resources.steps',
  matches: 'importPreview.resources.matches',
}

const STEP_STATUSES = new Set<string>(['pending', 'ongoing', 'finished'])
const PARTICIPANT_STATUSES = new Set<string>(['in', 'qualified', 'eliminated'])
const MATCH_STATUSES = new Set<string>(['scheduled', 'ongoing', 'finished', 'cancelled'])
const RESULTS = new Set<string>(['win', 'loss', 'draw'])

interface ImportPreviewPanelProps {
  preview: PreviewState<TournamentImportPreview>
  busy: boolean
  applying: boolean
  onConfirm: (confirmDestructive: boolean) => void
  onCancel: () => void
  onRefresh: () => void
}

// Aperçu détaillé d'un import, calculé par le serveur : rien n'est écrit avant « Confirmer ».
// Les changements sont groupés par action (création, mise à jour, remplacement, suppression),
// distinguées par leur texte et leur icône, jamais par la seule couleur.
export function ImportPreviewPanel({ preview, busy, applying, onConfirm, onCancel, onRefresh }: ImportPreviewPanelProps) {
  const { t } = useI18n()
  const titleId = useId()
  const heading = useRef<HTMLHeadingElement>(null)
  const [consent, setConsent] = useState(false)
  const data = preview.data

  // Le focus va au titre de chaque nouvel aperçu (le parent remonte le panneau par aperçu, ce
  // qui remet aussi le consentement à zéro).
  useEffect(() => {
    heading.current?.focus()
  }, [data])

  const needsConsent = data?.requires_confirmation ?? false
  const canConfirm = Boolean(data?.valid && data.preview_id) && (!needsConsent || consent) && !busy

  return (
    <section aria-labelledby={titleId} className="grid gap-4 rounded-2xl p-4 ring-1 ring-foreground/15 sm:p-6">
      <div className="grid gap-1">
        <h2 id={titleId} ref={heading} tabIndex={-1} className="text-lg font-semibold focus:outline-none">
          {t('importPreview.title')}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t('importPreview.file', { name: preview.file.name, format: preview.file.format.toUpperCase() })}
        </p>
        <p className="text-sm">{t('importPreview.intro')}</p>
      </div>

      {data === null ? (
        <div className="grid gap-3">
          <p className="text-sm">{t('importPreview.outdated')}</p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={onRefresh} disabled={busy}>
              <Icon icon={RefreshIcon} />
              {t('importPreview.refresh')}
            </Button>
            <Button variant="outline" onClick={onCancel} disabled={busy}>
              {t('importPreview.cancel')}
            </Button>
          </div>
        </div>
      ) : (
        <>
          {data.valid && data.expires_in ? (
            <p className="text-sm text-muted-foreground">
              {t('importPreview.expires', { minutes: Math.max(1, Math.floor(data.expires_in / 60)) })}
            </p>
          ) : null}

          {data.errors.length > 0 ? (
            <div role="alert" className="grid gap-2 rounded-xl border border-destructive p-4 text-sm">
              <p className="font-semibold text-destructive">
                {t('importPreview.errorsTitle', { count: data.errors.length })}
              </p>
              <p>{t('importPreview.invalid')}</p>
              <ServerList items={data.errors} />
            </div>
          ) : null}

          {data.tournaments.map((tournament, index) => (
            <TournamentPreview key={`${tournament.game}-${tournament.name}-${index}`} tournament={tournament} />
          ))}

          {data.warnings.length > 0 ? (
            <div className="grid gap-2 rounded-xl bg-amber-50 p-4 text-sm text-amber-950 ring-1 ring-amber-500/30 ring-inset dark:bg-amber-500/15 dark:text-amber-50">
              <p className="flex items-center gap-2 font-semibold">
                <Icon icon={Alert02Icon} size={18} />
                {t('importPreview.warningsTitle', { count: data.warnings.length })}
              </p>
              <ServerList items={data.warnings} />
            </div>
          ) : null}

          {needsConsent ? (
            <div className="grid gap-2 rounded-xl border border-destructive p-4 text-sm">
              <p className="flex items-center gap-2 font-semibold text-destructive">
                <Icon icon={Alert02Icon} size={18} />
                {t('importPreview.destructiveTitle')}
              </p>
              <p>{t('importPreview.destructive')}</p>
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-1 size-4"
                  checked={consent}
                  disabled={busy}
                  onChange={(event) => setConsent(event.target.checked)}
                />
                <span>{t('importPreview.consent')}</span>
              </label>
            </div>
          ) : null}

          {applying ? (
            <p role="status" className="text-sm font-medium">
              {t('importPreview.applying')}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {data.valid ? (
              <Button
                variant={needsConsent ? 'destructive' : 'default'}
                disabled={!canConfirm}
                aria-busy={applying || undefined}
                onClick={() => onConfirm(needsConsent && consent)}
              >
                {t('importPreview.confirm')}
              </Button>
            ) : null}
            <Button variant="outline" onClick={onCancel} disabled={applying}>
              {t('importPreview.cancel')}
            </Button>
          </div>
        </>
      )}
    </section>
  )
}

// Textes libres du serveur (erreurs, avertissements, conséquences), dans sa langue.
function ServerList({ items }: { items: string[] }) {
  const { t } = useI18n()
  return (
    <div className="grid gap-1">
      <p className="text-xs text-muted-foreground">{t('importPreview.serverText')}</p>
      <ul className="grid list-disc gap-1 pl-5">
        {items.map((item, index) => (
          <li key={`${index}-${item}`}>{item}</li>
        ))}
      </ul>
    </div>
  )
}

function ActionLabel({ action }: { action: ImportChangeAction }) {
  const { t } = useI18n()
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold ring-1 ring-inset',
        action === 'delete' || action === 'replace' ? 'text-destructive ring-destructive/40' : 'ring-foreground/20',
      )}
    >
      <Icon icon={ACTION_ICON[action]} size={14} />
      {t(ACTION_KEY[action])}
    </span>
  )
}

function TournamentPreview({ tournament }: { tournament: ImportTournamentChanges }) {
  const { t } = useI18n()
  const titleId = useId()
  const resource = (change: ImportResourceChange) =>
    RESOURCE_KEY[change.resource] ? t(RESOURCE_KEY[change.resource]) : change.resource
  return (
    <article
      aria-labelledby={titleId}
      className={cn('grid gap-4 rounded-xl p-4 ring-1', tournament.destructive ? 'ring-destructive/50' : 'ring-foreground/10')}
    >
      <header className="flex flex-wrap items-center gap-2">
        <h3 id={titleId} className="font-semibold">
          {t('importPreview.tournament', { name: tournament.name, game: tournament.game })}
        </h3>
        <ActionLabel action={tournament.action} />
        {tournament.destructive ? (
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-destructive">
            <Icon icon={Alert02Icon} size={14} />
            {t('importPreview.destructiveBadge')}
          </span>
        ) : null}
      </header>

      <div className="grid gap-3">
        <h4 className="text-sm font-semibold">{t('importPreview.changesTitle')}</h4>
        {ACTIONS.map((action) => {
          const changes = tournament.changes.filter((change) => change.action === action)
          if (changes.length === 0) return null
          return (
            <div key={action} className="grid gap-1">
              <ActionLabel action={action} />
              <ul className="grid gap-1 pl-1 text-sm">
                {changes.map((change) => (
                  <li key={change.resource} className="flex flex-wrap gap-x-2">
                    <span className="font-medium">{resource(change)}</span>
                    <span className="text-muted-foreground">
                      {t('importPreview.countChange', { before: change.before, after: change.after })}
                    </span>
                    {change.details ? <span className="text-muted-foreground">({change.details})</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
      </div>

      {tournament.downstream.length > 0 ? (
        <div className="grid gap-1 text-sm">
          <h4 className="font-semibold">{t('importPreview.downstreamTitle')}</h4>
          <ServerList items={tournament.downstream} />
        </div>
      ) : null}

      <div className="grid gap-2">
        <h4 className="text-sm font-semibold">{t('importPreview.stepsTitle')}</h4>
        {tournament.steps === undefined ? (
          <p className="text-sm text-muted-foreground">{t('importPreview.stepsUnavailable')}</p>
        ) : tournament.steps.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('importPreview.noSteps')}</p>
        ) : (
          tournament.steps.map((step) => <StepPreview key={step.position} step={step} />)
        )}
      </div>
    </article>
  )
}

function StepPreview({ step }: { step: ImportStepPreview }) {
  const { t } = useI18n()
  const [shown, setShown] = useState(MATCH_PAGE)
  const status = STEP_STATUSES.has(step.status) ? t(stepStatusLabelKey(step.status as StepStatus)) : step.status
  const remaining = step.matches.length - shown
  return (
    <details className="rounded-lg p-3 ring-1 ring-foreground/10">
      <summary className="cursor-pointer text-sm font-medium">
        {t('importPreview.step', { position: step.position, status })}
      </summary>
      <div className="mt-3 grid gap-4">
        {step.groups.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('importPreview.noGroups')}</p>
        ) : (
          step.groups.map((group) => (
            <div key={group.index} className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <caption className="pb-1 text-left font-medium">{t('importPreview.group', { index: group.index })}</caption>
                <thead>
                  <tr className="text-muted-foreground">
                    <th scope="col" className="pr-3 font-medium">{t('importPreview.seed')}</th>
                    <th scope="col" className="pr-3 font-medium">{t('importPreview.participant')}</th>
                    <th scope="col" className="pr-3 font-medium">{t('importPreview.points')}</th>
                    <th scope="col" className="pr-3 font-medium">{t('importPreview.rank')}</th>
                    <th scope="col" className="font-medium">{t('importPreview.status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {group.participants.map((member, index) => (
                    <tr key={`${member.name}-${index}`}>
                      <td className="pr-3">{member.seed ?? t('importPreview.none')}</td>
                      <td className="pr-3">{member.name}</td>
                      <td className="pr-3">{member.points}</td>
                      <td className="pr-3">{member.rank ?? t('importPreview.none')}</td>
                      <td>
                        {PARTICIPANT_STATUSES.has(member.status)
                          ? t(stepParticipantStatusLabelKey(member.status as StepParticipantStatus))
                          : member.status}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))
        )}

        <div className="grid gap-2">
          <p className="text-sm font-medium">{t('importPreview.matchesTitle', { count: step.matches.length })}</p>
          {step.matches.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('importPreview.noMatches')}</p>
          ) : (
            <ul className="grid gap-2">
              {step.matches.slice(0, shown).map((match) => (
                <MatchPreview key={match.index} match={match} />
              ))}
            </ul>
          )}
          {remaining > 0 ? (
            <Button variant="outline" size="sm" className="justify-self-start" onClick={() => setShown((n) => n + MATCH_PAGE)}>
              {t('importPreview.more', { count: remaining })}
            </Button>
          ) : null}
        </div>
      </div>
    </details>
  )
}

function MatchPreview({ match }: { match: ImportMatchPreview }) {
  const { t } = useI18n()
  const status = MATCH_STATUSES.has(match.status) ? t(matchStatusLabelKey(match.status as MatchStatus)) : match.status
  return (
    <li className="grid gap-1 rounded-lg bg-muted/40 p-2 text-sm">
      <p className="flex flex-wrap gap-x-2 font-medium">
        <span>{t('importPreview.match', { index: match.index })}</span>
        <span className="text-muted-foreground">{status}</span>
        {match.next !== null ? (
          <span className="text-muted-foreground">{t('importPreview.next', { number: match.next })}</span>
        ) : null}
      </p>
      <ul className="grid gap-0.5 pl-3">
        {match.participants.map((entry, index) => (
          <li key={`${entry.name}-${index}`}>
            {t('importPreview.entry', {
              name: entry.name,
              points: entry.points,
              rank: entry.rank ?? t('importPreview.none'),
              result:
                entry.result && RESULTS.has(entry.result)
                  ? t(resultLabelKey(entry.result as MatchResult))
                  : (entry.result ?? t('importPreview.none')),
            })}
          </li>
        ))}
      </ul>
    </li>
  )
}
