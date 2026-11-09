import { Alert02Icon, CheckmarkCircle02Icon } from '@hugeicons/core-free-icons'

import { Icon } from '@/components/ui/icon'
import type { Step } from '@/features/steps/types'
import { chainProblems } from '@/features/steps/validation'
import type { Tournament } from '@/features/tournaments/types'
import { useI18n } from '@/i18n/context'

// Vérification du chaînage (mêmes règles que le serveur au démarrage du tournoi), annoncée en
// texte : vert si valide, liste des problèmes sinon. Rien s'il n'y a aucune étape.
export function ChainCheck({ tournament, steps }: { tournament: Tournament; steps: readonly Step[] }) {
  const { t } = useI18n()
  if (steps.length === 0) return null
  const problems = chainProblems(tournament, steps)

  if (problems.length === 0) {
    return (
      <p className="flex items-start gap-2 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-900 ring-1 ring-emerald-600/25 ring-inset dark:bg-emerald-500/15 dark:text-emerald-100">
        <Icon icon={CheckmarkCircle02Icon} size={18} className="mt-0.5 shrink-0 text-emerald-700 dark:text-emerald-300" />
        {t('steps.chain.ok')}
      </p>
    )
  }
  return (
    <div className="grid gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-950 ring-1 ring-amber-500/30 ring-inset dark:bg-amber-500/15 dark:text-amber-50">
      <p className="flex items-start gap-2 font-medium">
        <Icon icon={Alert02Icon} size={18} className="mt-0.5 shrink-0 text-amber-700 dark:text-amber-300" />
        {t('steps.chain.problems')}
      </p>
      <ul className="list-disc space-y-1 pl-11">
        {problems.map((problem) => (
          <li key={`${problem.key}-${JSON.stringify(problem.params)}`}>{t(problem.key, problem.params)}</li>
        ))}
      </ul>
    </div>
  )
}
