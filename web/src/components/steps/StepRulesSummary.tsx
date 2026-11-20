import { qualificationDescKey, qualificationLabelKey, seedingDescKey, seedingLabelKey } from '@/features/steps/labels'
import type { Step } from '@/features/steps/types'
import { formatPoints } from '@/features/tournaments/format'
import { useI18n } from '@/i18n/context'

// Réglages avancés de l'étape tels que renvoyés par le serveur : têtes de série, qualification,
// séries et barème. Une étape historique affiche les valeurs par défaut du serveur.
export function StepRulesSummary({ step }: { step: Step }) {
  const { t, lang } = useI18n()
  const { rules } = step
  const rounds = Object.entries(rules.best_of_by_round).sort(([a], [b]) => Number(a) - Number(b))
  const points = (value: number) => formatPoints(lang, value)

  return (
    <div className="grid gap-3 rounded-xl bg-card p-4 shadow-sm ring-1 ring-foreground/10">
      <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{t('steps.rules.title')}</h3>
      <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div className="grid content-start gap-1">
          <dt className="text-muted-foreground">{t('steps.rules.seeding')}</dt>
          <dd>
            <span className="block font-semibold">{t(seedingLabelKey(rules.seeding))}</span>
            <span className="block text-muted-foreground">{t(seedingDescKey(rules.seeding))}</span>
          </dd>
        </div>
        <div className="grid content-start gap-1">
          <dt className="text-muted-foreground">{t('steps.rules.qualification')}</dt>
          <dd>
            <span className="block font-semibold">{t(qualificationLabelKey(rules.qualification))}</span>
            <span className="block text-muted-foreground">{t(qualificationDescKey(rules.qualification))}</span>
          </dd>
        </div>
        <div className="grid content-start gap-1">
          <dt className="text-muted-foreground">{t('steps.rules.series')}</dt>
          <dd className="grid gap-0.5">
            {step.match_type === 'ffa' ? (
              <span>{t('steps.rules.seriesFfaShort')}</span>
            ) : (
              <>
                <span className="font-semibold">{t('steps.rules.defaultSeriesValue', { count: rules.best_of })}</span>
                {rounds.length > 0 ? (
                  <ul aria-label={t('steps.rules.roundSeries')} className="grid gap-0.5">
                    {rounds.map(([round, bestOf]) => (
                      <li key={round}>{t('steps.rules.roundSeriesValue', { round, count: bestOf })}</li>
                    ))}
                  </ul>
                ) : null}
              </>
            )}
          </dd>
        </div>
        <div className="grid content-start gap-1">
          <dt className="text-muted-foreground">{t('steps.rules.scoring')}</dt>
          <dd className="grid gap-0.5">
            {rules.scoring === null ? (
              <span>{t('steps.rules.tournamentScoring')}</span>
            ) : step.match_type === 'duel' ? (
              <span>
                {t('steps.rules.duelScoringValue', {
                  win: points(rules.scoring.win),
                  draw: points(rules.scoring.draw),
                  loss: points(rules.scoring.loss),
                })}
              </span>
            ) : rules.scoring.placement.length === 0 ? (
              <span>{t('steps.rules.noPlacement')}</span>
            ) : (
              <ol aria-label={t('steps.rules.placementPoints')} className="grid gap-0.5">
                {rules.scoring.placement.map((value, index) => (
                  <li key={index}>{t('steps.rules.rankPointsValue', { rank: index + 1, points: points(value) })}</li>
                ))}
              </ol>
            )}
          </dd>
        </div>
      </dl>
    </div>
  )
}
