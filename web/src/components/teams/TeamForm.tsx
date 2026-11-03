import { useEffect, useRef, useState, type FormEvent } from 'react'

import { ErrorSummary, type ErrorSummaryItem } from '@/components/form/ErrorSummary'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import type { Game } from '@/features/games/types'
import type { TeamField, TeamFieldErrors, TeamValues } from '@/features/teams/types'
import { validateTeam } from '@/features/teams/validation'
import { useI18n, type MessageKey } from '@/i18n/context'

const EMPTY: TeamValues = { name: '', tag: '', picture_url: '' }

const IDS: Record<TeamField, string> = {
  game_id: 'team-game',
  name: 'team-name',
  tag: 'team-tag',
  picture_url: 'team-picture',
}
const ORDER: TeamField[] = ['game_id', 'name', 'tag', 'picture_url']

interface TeamFormProps {
  initial?: TeamValues
  // Liste des jeux : le champ « Jeu » n'est affiché qu'à la création d'une équipe globale.
  games?: Game[]
  initialGameId?: string
  submitLabel: string
  busy: boolean
  serverErrors?: TeamFieldErrors
  formError?: MessageKey | null
  // `clearHint` : rappelle qu'un champ vidé efface la valeur (modification).
  clearHint?: boolean
  onSubmit: (values: TeamValues, gameId: string) => void
  onCancel: () => void
}

export function TeamForm({
  initial = EMPTY,
  games,
  initialGameId = '',
  submitLabel,
  busy,
  serverErrors,
  formError,
  clearHint,
  onSubmit,
  onCancel,
}: TeamFormProps) {
  const { t } = useI18n()
  const summaryRef = useRef<HTMLDivElement>(null)
  const [values, setValues] = useState<TeamValues>(initial)
  const [gameId, setGameId] = useState(initialGameId)
  const [errors, setErrors] = useState<TeamFieldErrors>({})
  const [focusSummary, setFocusSummary] = useState(0)

  useEffect(() => {
    if (focusSummary > 0) summaryRef.current?.focus()
  }, [focusSummary])

  // Une erreur renvoyée par le serveur ramène le focus sur le résumé.
  useEffect(() => {
    if ((serverErrors && Object.keys(serverErrors).length > 0) || formError) {
      summaryRef.current?.focus()
    }
  }, [serverErrors, formError])

  function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    const found = validateTeam(values, games ? gameId : undefined)
    setErrors(found)
    if (Object.keys(found).length > 0) {
      setFocusSummary((n) => n + 1)
      return
    }
    onSubmit(values, gameId)
  }

  const messages: Partial<Record<TeamField, string>> = {}
  for (const field of ORDER) {
    const key = errors[field] ?? serverErrors?.[field]
    if (key) messages[field] = t(key)
  }
  const items: ErrorSummaryItem[] = [
    ...ORDER.flatMap((field) => (messages[field] ? [{ fieldId: IDS[field], message: messages[field] }] : [])),
    ...(formError ? [{ message: t(formError) }] : []),
  ]

  const describe = (field: TeamField, hint?: string) =>
    [hint, messages[field] ? `${IDS[field]}-error` : null].filter(Boolean).join(' ') || undefined

  const fieldError = (field: TeamField) =>
    messages[field] ? (
      <p id={`${IDS[field]}-error`} className="text-sm text-destructive">
        <span className="font-medium">{t('common.error')}</span> {messages[field]}
      </p>
    ) : null

  return (
    <form onSubmit={submit} noValidate aria-busy={busy} className="grid gap-6">
      <ErrorSummary ref={summaryRef} items={items} title={t('teams.validation.fixErrors')} />
      <p className="text-sm text-muted-foreground">
        {t('teams.formHint')}
        {clearHint ? ` ${t('teams.clearHint')}` : ''}
      </p>

      {games ? (
        <div className="grid gap-2">
          <Label htmlFor={IDS.game_id}>{t('teams.game')}</Label>
          <NativeSelect
            id={IDS.game_id}
            value={gameId}
            required
            aria-invalid={messages.game_id ? true : undefined}
            aria-describedby={describe('game_id')}
            onChange={(event) => setGameId(event.target.value)}
          >
            <option value="">{t('teams.chooseGame')}</option>
            {games.map((game) => (
              <option key={game.id} value={game.id}>
                {game.name}
              </option>
            ))}
          </NativeSelect>
          {fieldError('game_id')}
        </div>
      ) : null}

      <div className="grid gap-2">
        <Label htmlFor={IDS.name}>{t('teams.name')}</Label>
        <Input
          id={IDS.name}
          value={values.name}
          required
          autoComplete="off"
          aria-invalid={messages.name ? true : undefined}
          aria-describedby={describe('name', 'team-name-hint')}
          onChange={(event) => setValues({ ...values, name: event.target.value })}
        />
        <p id="team-name-hint" className="text-sm text-muted-foreground">
          {t('teams.nameHint')}
        </p>
        {fieldError('name')}
      </div>

      <div className="grid gap-2">
        <Label htmlFor={IDS.tag}>{t('teams.tagOptional')}</Label>
        <Input
          id={IDS.tag}
          value={values.tag}
          autoComplete="off"
          aria-invalid={messages.tag ? true : undefined}
          aria-describedby={describe('tag', 'team-tag-hint')}
          onChange={(event) => setValues({ ...values, tag: event.target.value })}
        />
        <p id="team-tag-hint" className="text-sm text-muted-foreground">
          {t('teams.tagHint')}
        </p>
        {fieldError('tag')}
      </div>

      <div className="grid gap-2">
        <Label htmlFor={IDS.picture_url}>{t('teams.pictureOptional')}</Label>
        <Input
          id={IDS.picture_url}
          type="url"
          inputMode="url"
          placeholder="https://"
          value={values.picture_url}
          autoComplete="off"
          aria-invalid={messages.picture_url ? true : undefined}
          aria-describedby={describe('picture_url', 'team-picture-hint')}
          onChange={(event) => setValues({ ...values, picture_url: event.target.value })}
        />
        <p id="team-picture-hint" className="text-sm text-muted-foreground">
          {t('teams.pictureHint')}
        </p>
        {fieldError('picture_url')}
      </div>

      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={busy}>
          {busy ? t('teams.saving') : submitLabel}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
      </div>
    </form>
  )
}
