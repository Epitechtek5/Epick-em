import { Add01Icon, Cancel01Icon, Medal01Icon, RankingIcon, ShuffleIcon } from '@hugeicons/core-free-icons'
import type { ReactNode } from 'react'

import { FormSection } from '@/components/tournaments/ui'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { qualificationDescKey, qualificationLabelKey, seedingDescKey, seedingLabelKey } from '@/features/steps/labels'
import {
  BEST_OF_VALUES,
  QUALIFICATION_PLACEMENTS,
  SEEDING_STRATEGIES,
  type BestOf,
  type MatchType,
  type RulesValues,
  type StepFormat,
} from '@/features/steps/types'
import { parseInteger, ROUND_MAX } from '@/features/steps/validation'
import { useI18n } from '@/i18n/context'

const RADIO_CARD =
  'flex cursor-pointer items-start gap-3 rounded-xl p-3 ring-1 ring-foreground/15 transition-colors ring-inset hover:bg-muted/40 has-checked:bg-primary/5 has-checked:ring-2 has-checked:ring-primary has-focus-visible:outline-3 has-focus-visible:outline-ring/50 motion-reduce:transition-none dark:has-checked:bg-primary/15'

// Nom des rondes selon le format : manche (poules), ronde (suisse) ou tour (élimination).
const ROUND_HINT: Record<StepFormat, 'steps.rules.roundHint.pool' | 'steps.rules.roundHint.swiss' | 'steps.rules.roundHint.elim'> = {
  pool: 'steps.rules.roundHint.pool',
  swiss: 'steps.rules.roundHint.swiss',
  single_elim: 'steps.rules.roundHint.elim',
  double_elim: 'steps.rules.roundHint.elim',
}

// Réglages avancés d'une étape (rules) : têtes de série et qualification, séries BO1/BO3/BO5 par
// défaut et par ronde (duels seulement), barème propre à l'étape. Les valeurs sont validées
// avec le reste du formulaire ; le serveur génère et applique tout.
export function StepRulesFields({
  id,
  value,
  format,
  matchType,
  isLast,
  onChange,
  error,
  describedBy,
}: {
  // Identifiant du premier champ (cible du résumé d'erreurs).
  id: string
  value: RulesValues
  format: StepFormat
  matchType: MatchType
  // Dernière étape : la qualification n'a pas d'étape suivante où placer les qualifiés.
  isLast: boolean
  onChange: (value: RulesValues) => void
  error?: ReactNode
  describedBy?: string
}) {
  const { t } = useI18n()
  const set = <K extends keyof RulesValues>(key: K, next: RulesValues[K]) => onChange({ ...value, [key]: next })
  const duel = matchType === 'duel'

  function addRound() {
    const used = value.rounds.map((row) => parseInteger(row.round) ?? 0)
    const round = Math.min(ROUND_MAX, Math.max(0, ...used) + 1)
    set('rounds', [...value.rounds, { round: String(round), best_of: value.best_of === 1 ? 3 : value.best_of }])
  }

  const seriesSelect = (selectId: string, current: BestOf, onSelect: (bestOf: BestOf) => void, labelId?: string) => (
    <NativeSelect
      id={selectId}
      value={String(current)}
      aria-labelledby={labelId}
      className="h-9"
      onChange={(event) => onSelect(Number(event.target.value) as BestOf)}
    >
      {BEST_OF_VALUES.map((bestOf) => (
        <option key={bestOf} value={bestOf}>
          {t('steps.rules.bestOfOption', { count: bestOf, wins: (bestOf + 1) / 2 })}
        </option>
      ))}
    </NativeSelect>
  )

  return (
    <>
      <FormSection icon={ShuffleIcon} title={t('steps.sections.placement')}>
        {error}
        <fieldset className="grid gap-2" aria-describedby={describedBy}>
          <legend className="text-sm font-medium">{t('steps.rules.seeding')}</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {SEEDING_STRATEGIES.map((seeding, index) => (
              <label key={seeding} className={RADIO_CARD}>
                <input
                  id={index === 0 ? id : `${id}-seeding-${seeding}`}
                  type="radio"
                  name="seeding"
                  value={seeding}
                  checked={value.seeding === seeding}
                  aria-describedby={`step-seeding-${seeding}-desc`}
                  onChange={() => set('seeding', seeding)}
                  className="mt-1 size-4 shrink-0 accent-primary"
                />
                <span className="grid gap-1">
                  <span className="font-semibold">{t(seedingLabelKey(seeding))}</span>
                  <span id={`step-seeding-${seeding}-desc`} className="text-sm text-muted-foreground">
                    {t(seedingDescKey(seeding))}
                  </span>
                </span>
              </label>
            ))}
          </div>
          <p className="text-sm text-muted-foreground">{t('steps.rules.seedingHint')}</p>
        </fieldset>

        <fieldset className="grid gap-2">
          <legend className="text-sm font-medium">{t('steps.rules.qualification')}</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {QUALIFICATION_PLACEMENTS.map((qualification) => (
              <label key={qualification} className={RADIO_CARD}>
                <input
                  type="radio"
                  name="qualification"
                  value={qualification}
                  checked={value.qualification === qualification}
                  aria-describedby={`step-qualification-${qualification}-desc`}
                  onChange={() => set('qualification', qualification)}
                  className="mt-1 size-4 shrink-0 accent-primary"
                />
                <span className="grid gap-1">
                  <span className="font-semibold">{t(qualificationLabelKey(qualification))}</span>
                  <span id={`step-qualification-${qualification}-desc`} className="text-sm text-muted-foreground">
                    {t(qualificationDescKey(qualification))}
                  </span>
                </span>
              </label>
            ))}
          </div>
          <p className="text-sm text-muted-foreground">
            {t(isLast ? 'steps.rules.qualificationLast' : 'steps.rules.qualificationHint')}
          </p>
        </fieldset>
      </FormSection>

      <FormSection icon={Medal01Icon} title={t('steps.sections.series')}>
        {duel ? (
          <>
            <div className="grid gap-2 sm:max-w-xs">
              <Label htmlFor="step-best-of">{t('steps.rules.defaultSeries')}</Label>
              {seriesSelect('step-best-of', value.best_of, (bestOf) => set('best_of', bestOf))}
            </div>
            <div className="grid gap-2">
              <p className="text-sm font-medium">{t('steps.rules.roundSeries')}</p>
              <p className="text-sm text-muted-foreground">{t(ROUND_HINT[format], { max: ROUND_MAX })}</p>
              {value.rounds.length === 0 ? (
                <p className="rounded-xl border border-dashed px-4 py-3 text-sm text-muted-foreground">{t('steps.rules.noRoundSeries')}</p>
              ) : (
                <ul aria-label={t('steps.rules.roundSeries')} className="grid gap-2">
                  {value.rounds.map((row, index) => {
                    const roundId = `step-round-${index}`
                    return (
                      <li
                        key={index}
                        className="flex flex-wrap items-end gap-3 rounded-xl bg-background/60 px-3 py-2 ring-1 ring-foreground/10 dark:bg-input/20"
                      >
                        <div className="grid gap-1">
                          <Label htmlFor={roundId}>{t('steps.rules.roundNumber')}</Label>
                          <Input
                            id={roundId}
                            type="number"
                            inputMode="numeric"
                            min={1}
                            max={ROUND_MAX}
                            step={1}
                            className="w-24"
                            value={row.round}
                            onChange={(event) =>
                              set(
                                'rounds',
                                value.rounds.map((other, i) => (i === index ? { ...other, round: event.target.value } : other)),
                              )
                            }
                          />
                        </div>
                        <div className="grid gap-1">
                          <Label htmlFor={`${roundId}-series`}>{t('steps.rules.roundFormat', { round: row.round || '?' })}</Label>
                          {seriesSelect(`${roundId}-series`, row.best_of, (bestOf) =>
                            set(
                              'rounds',
                              value.rounds.map((other, i) => (i === index ? { ...other, best_of: bestOf } : other)),
                            ),
                          )}
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={t('steps.rules.removeRound', { round: row.round || '?' })}
                          onClick={() => set('rounds', value.rounds.filter((_, i) => i !== index))}
                        >
                          <Icon icon={Cancel01Icon} />
                        </Button>
                      </li>
                    )
                  })}
                </ul>
              )}
              <Button type="button" variant="outline" className="w-fit" onClick={addRound}>
                <Icon icon={Add01Icon} />
                {t('steps.rules.addRound')}
              </Button>
            </div>
          </>
        ) : (
          <p className="rounded-xl bg-muted/50 px-4 py-3 text-sm text-muted-foreground">{t('steps.rules.seriesFfa')}</p>
        )}
      </FormSection>

      <FormSection icon={RankingIcon} title={t('steps.sections.scoring')}>
        <fieldset className="grid gap-2">
          <legend className="sr-only">{t('steps.rules.scoring')}</legend>
          {([false, true] as const).map((custom) => (
            <label key={String(custom)} className={RADIO_CARD}>
              <input
                type="radio"
                name="custom_scoring"
                checked={value.custom_scoring === custom}
                onChange={() => set('custom_scoring', custom)}
                className="mt-1 size-4 shrink-0 accent-primary"
              />
              <span className="grid gap-1">
                <span className="font-semibold">{t(custom ? 'steps.rules.customScoring' : 'steps.rules.tournamentScoring')}</span>
                <span className="text-sm text-muted-foreground">
                  {t(custom ? 'steps.rules.customScoringDesc' : 'steps.rules.tournamentScoringDesc')}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
        {value.custom_scoring ? (
          <div className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-3">
              {(['win', 'draw', 'loss'] as const).map((key) => (
                <div key={key} className="grid gap-2">
                  <Label htmlFor={`step-points-${key}`}>{t(`steps.rules.points.${key}`)}</Label>
                  <Input
                    id={`step-points-${key}`}
                    inputMode="decimal"
                    value={value[key]}
                    onChange={(event) => set(key, event.target.value)}
                  />
                </div>
              ))}
            </div>
            <p className="text-sm text-muted-foreground">{t(duel ? 'steps.rules.duelPointsHint' : 'steps.rules.ffaPointsHint')}</p>
            {duel ? null : (
              <div className="grid gap-2">
                <p className="text-sm font-medium">{t('steps.rules.placementPoints')}</p>
                {value.placement.length === 0 ? (
                  <p className="rounded-xl border border-dashed px-4 py-3 text-sm text-muted-foreground">{t('steps.rules.noPlacement')}</p>
                ) : (
                  <ol aria-label={t('steps.rules.placementPoints')} className="grid gap-2 sm:grid-cols-2">
                    {value.placement.map((points, index) => (
                      <li key={index} className="flex items-end gap-2">
                        <div className="grid flex-1 gap-1">
                          <Label htmlFor={`step-placement-${index}`}>{t('steps.rules.rankPoints', { rank: index + 1 })}</Label>
                          <Input
                            id={`step-placement-${index}`}
                            inputMode="decimal"
                            value={points}
                            onChange={(event) =>
                              set(
                                'placement',
                                value.placement.map((other, i) => (i === index ? event.target.value : other)),
                              )
                            }
                          />
                        </div>
                        {index === value.placement.length - 1 ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={t('steps.rules.removePlacement', { rank: index + 1 })}
                            onClick={() => set('placement', value.placement.slice(0, -1))}
                          >
                            <Icon icon={Cancel01Icon} />
                          </Button>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                )}
                <Button type="button" variant="outline" className="w-fit" onClick={() => set('placement', [...value.placement, '0'])}>
                  <Icon icon={Add01Icon} />
                  {t('steps.rules.addPlacement')}
                </Button>
              </div>
            )}
          </div>
        ) : null}
      </FormSection>
    </>
  )
}
