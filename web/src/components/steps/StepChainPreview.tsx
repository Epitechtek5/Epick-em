import { Alert02Icon, CheckmarkCircle02Icon, Route01Icon } from '@hugeicons/core-free-icons'

import { Icon } from '@/components/ui/icon'
import { formatLabelKey } from '@/features/steps/labels'
import type { Step, StepValues } from '@/features/steps/types'
import {
  capacityOf,
  expectedCapacity,
  expectedQualified,
  partialInput,
  qualifiedOf,
} from '@/features/steps/validation'
import type { Tournament } from '@/features/tournaments/types'
import { useI18n } from '@/i18n/context'
import { cn } from '@/lib/utils'

// Comparaison d'une valeur à celle qu'attend le chaînage, écrite en texte (pas seulement en couleur).
function Check({ ok }: { ok: boolean }) {
  const { t } = useI18n()
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-xs font-semibold',
        ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-800 dark:text-amber-200',
      )}
    >
      <Icon icon={ok ? CheckmarkCircle02Icon : Alert02Icon} size={14} />
      {t(ok ? 'steps.preview.matches' : 'steps.preview.mismatch')}
    </span>
  )
}

// Aperçu en direct du chaînage : l'étape saisie parmi les autres étapes du tournoi, avec ce
// qu'elle accueille et qualifie face à ce qu'attendent le tournoi et les étapes voisines.
// Indicatif : le serveur vérifie le chaînage au démarrage du tournoi.
export function StepChainPreview({
  values,
  tournament,
  others,
}: {
  values: StepValues
  tournament: Tournament
  others: readonly Step[]
}) {
  const { t } = useI18n()
  const input = partialInput(values)
  const rows = [
    ...others.map((step) => ({ key: step.id, current: false, step })),
    ...(input ? [{ key: 'current', current: true, step: input }] : []),
  ].sort((a, b) => a.step.position - b.step.position || Number(a.current) - Number(b.current))

  const expectedIn = input ? expectedCapacity(tournament, others, input.position) : null
  const expectedOut = input ? expectedQualified(others, input.position) : null

  return (
    <aside aria-labelledby="step-preview-title" className="grid gap-4 lg:sticky lg:top-6">
      <div className="grid gap-0.5">
        <h2 id="step-preview-title" className="flex items-center gap-2 text-sm font-semibold tracking-wide text-muted-foreground uppercase">
          <Icon icon={Route01Icon} />
          {t('steps.preview.title')}
        </h2>
        <p className="text-sm text-muted-foreground">{t('steps.preview.hint')}</p>
      </div>

      {input ? (
        <div className="grid gap-3 rounded-2xl bg-card p-4 shadow-sm ring-1 ring-foreground/10">
          <dl className="grid gap-3 text-sm">
            <div className="grid gap-1">
              <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{t('steps.preview.receives')}</dt>
              <dd className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-mono text-lg font-bold tabular-nums">{capacityOf(input)}</span>
                <span className="text-muted-foreground">
                  {expectedIn === null ? t('steps.preview.unknownPrevious') : t('steps.preview.expected', { count: expectedIn })}
                </span>
                {expectedIn !== null ? <Check ok={capacityOf(input) === expectedIn} /> : null}
              </dd>
            </div>
            <div className="grid gap-1">
              <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{t('steps.preview.sends')}</dt>
              <dd className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-mono text-lg font-bold tabular-nums">{qualifiedOf(input)}</span>
                <span className="text-muted-foreground">
                  {expectedOut === 1 && !others.some((step) => step.position > input.position)
                    ? t('steps.preview.lastStep')
                    : t('steps.preview.expected', { count: expectedOut ?? 0 })}
                </span>
                <Check ok={qualifiedOf(input) === expectedOut} />
              </dd>
            </div>
          </dl>
        </div>
      ) : (
        <p className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">{t('steps.preview.incomplete')}</p>
      )}

      {rows.length > 0 ? (
        <ol className="grid gap-2 rounded-2xl bg-card p-4 text-sm shadow-sm ring-1 ring-foreground/10">
          <li className="flex items-center justify-between gap-2 text-xs font-medium text-muted-foreground">
            <span>{t('tournaments.capacity')}</span>
            <span className="font-mono tabular-nums">{tournament.max_participants}</span>
          </li>
          {rows.map((row) => (
            <li
              key={row.key}
              aria-current={row.current ? 'step' : undefined}
              className={cn(
                'grid gap-0.5 rounded-xl px-3 py-2 ring-1 ring-inset',
                row.current ? 'bg-primary/5 ring-2 ring-primary dark:bg-primary/15' : 'ring-foreground/10',
              )}
            >
              <span className="font-semibold">
                {t('steps.positionTitle', { position: row.step.position })} · {t(formatLabelKey(row.step.format))}
              </span>
              <span className="text-muted-foreground">
                {t('steps.flow', { capacity: capacityOf(row.step), qualified: qualifiedOf(row.step) })}
              </span>
            </li>
          ))}
        </ol>
      ) : null}

      <p className="text-xs text-muted-foreground">{t('steps.chain.hint')}</p>
    </aside>
  )
}
