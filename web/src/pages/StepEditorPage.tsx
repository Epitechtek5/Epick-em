import { Add01Icon, ArrowLeft01Icon, Edit02Icon, LockedIcon } from '@hugeicons/core-free-icons'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'

import { StateMessage } from '@/components/games/StateMessage'
import { StepStatusBadge } from '@/components/steps/StepBadges'
import { StepChainPreview } from '@/components/steps/StepChainPreview'
import { StepForm } from '@/components/steps/StepForm'
import { PageHero } from '@/components/tournaments/ui'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { createStep, listSteps, updateStep } from '@/features/steps/api'
import { stepErrorKey, stepFieldErrors } from '@/features/steps/errors'
import type { StepFieldErrors, StepValues } from '@/features/steps/types'
import { changedStepFields, emptyStep, nextPosition, stepsEditable, stepValues, toStepInput } from '@/features/steps/validation'
import { isUuid } from '@/features/teams/validation'
import { getTournament } from '@/features/tournaments/api'
import { useAsyncResource } from '@/hooks/use-async-resource'
import { useDocumentTitle } from '@/hooks/use-document-title'
import { useI18n, type MessageKey } from '@/i18n/context'
import { ApiError } from '@/lib/api/http'
import { useAuth } from '@/lib/auth/auth-context'

// Création (/tournaments/:tournamentId/steps/new, au statut `pending`) et modification
// (/tournaments/:tournamentId/steps/:stepId/edit) d'une étape, réservées aux administrateurs
// (AdminRoute ; le serveur reste juge) et possibles tant que le tournoi n'a pas démarré.
export default function StepEditorPage() {
  const { tournamentId = '', stepId } = useParams()
  const editing = stepId !== undefined
  const { t } = useI18n()
  const title = editing ? t('steps.edit') : t('steps.add')
  useDocumentTitle(title)
  const navigate = useNavigate()
  const { refreshRole } = useAuth()
  const valid = isUuid(tournamentId) && (!editing || isUuid(stepId))

  const { state, reload } = useAsyncResource(
    async (signal) => {
      if (!valid) throw new ApiError(404, undefined)
      const [tournament, steps] = await Promise.all([getTournament(tournamentId, signal), listSteps(tournamentId, signal)])
      const step = editing ? steps.find((candidate) => candidate.id === stepId) : undefined
      if (editing && !step) throw new ApiError(404, undefined)
      return { tournament, steps, step }
    },
    [tournamentId, stepId],
  )

  const [busy, setBusy] = useState(false)
  const [serverErrors, setServerErrors] = useState<StepFieldErrors>()
  const [formError, setFormError] = useState<MessageKey | null>(null)
  const [unchanged, setUnchanged] = useState(false)

  const data = state.status === 'success' ? state.data : null
  const others = data ? data.steps.filter((step) => step.id !== data.step?.id) : []
  const tournamentPath = `/tournaments/${tournamentId}`
  const backTo = editing && valid ? `${tournamentPath}/steps/${stepId}` : tournamentPath

  async function submit(values: StepValues) {
    if (!data) return
    setBusy(true)
    setServerErrors(undefined)
    setFormError(null)
    setUnchanged(false)
    try {
      const input = toStepInput(values)
      if (data.step) {
        const changes = changedStepFields(data.step, input)
        if (Object.keys(changes).length === 0) {
          setUnchanged(true)
          return
        }
        const saved = await updateStep(tournamentId, data.step.id, changes)
        navigate(`${tournamentPath}/steps/${saved.id}`, {
          replace: true,
          state: { notice: { key: 'steps.updated', params: { position: saved.position } } },
        })
      } else {
        const created = await createStep(tournamentId, input)
        navigate(`${tournamentPath}/steps/${created.id}`, {
          replace: true,
          state: { notice: { key: 'steps.created', params: { position: created.position } } },
        })
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) void refreshRole()
      const fields = stepFieldErrors(error)
      if (fields) setServerErrors(fields)
      else setFormError(stepErrorKey(error))
    } finally {
      setBusy(false)
    }
  }

  const editable = data ? stepsEditable(data.tournament.status) : false

  return (
    <div className="grid w-full max-w-6xl gap-6 self-start">
      <PageHero
        icon={editing ? Edit02Icon : Add01Icon}
        title={data?.step ? t('steps.editFor', { position: data.step.position }) : title}
        description={
          data ? (
            <span>
              <span className="font-semibold text-white">{data.tournament.name}</span>
              {editing ? null : <span className="block">{t('steps.createIntro')}</span>}
            </span>
          ) : undefined
        }
        back={
          <Link
            to={valid ? backTo : '/tournaments'}
            className="inline-flex items-center gap-1 font-medium text-white/90 underline underline-offset-4 hover:text-white"
          >
            <Icon icon={ArrowLeft01Icon} size={16} />
            {editing && valid ? t('steps.returnToStep') : valid ? t('steps.returnToTournament') : t('tournaments.returnToCatalog')}
          </Link>
        }
      >
        {data?.step ? <StepStatusBadge status={data.step.status} className="shadow-sm" /> : null}
      </PageHero>

      {!valid ? <StateMessage kind="error">{t(editing ? 'steps.errors.invalidId' : 'tournaments.errors.invalidId')}</StateMessage> : null}

      {valid && state.status === 'loading' ? <StateMessage kind="loading">{t('steps.loadingStep')}</StateMessage> : null}

      {valid && state.status === 'error' ? (
        <StateMessage
          kind="error"
          action={
            <Button variant="outline" size="sm" onClick={reload}>
              {t('common.retry')}
            </Button>
          }
        >
          {t(stepErrorKey(state.error))}
        </StateMessage>
      ) : null}

      {data && !editable ? (
        <p className="flex items-start gap-2 rounded-xl bg-amber-50 p-4 text-sm text-amber-950 ring-1 ring-amber-500/30 ring-inset dark:bg-amber-500/15 dark:text-amber-50">
          <Icon icon={LockedIcon} size={18} className="mt-0.5 shrink-0 text-amber-700 dark:text-amber-300" />
          <span>
            {t('steps.locked')}{' '}
            <Link to={backTo} className="font-medium underline underline-offset-4">
              {editing ? t('steps.returnToStep') : t('steps.returnToTournament')}
            </Link>
          </span>
        </p>
      ) : null}

      {unchanged ? <StateMessage kind="empty">{t('steps.noChanges')}</StateMessage> : null}

      {data && editable ? (
        <StepForm
          key={data.step?.id ?? 'new'}
          initial={data.step ? stepValues(data.step) : emptyStep(nextPosition(data.steps))}
          others={others}
          submitLabel={data.step ? t('common.save') : t('steps.create')}
          busy={busy}
          serverErrors={serverErrors}
          formError={formError}
          onSubmit={submit}
          onCancel={() => navigate(backTo)}
          preview={(values) => <StepChainPreview values={values} tournament={data.tournament} others={others} />}
        />
      ) : null}
    </div>
  )
}
