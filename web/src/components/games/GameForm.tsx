import { Add01Icon, ArrowDown01Icon, ArrowUp01Icon, Cancel01Icon } from '@hugeicons/core-free-icons'
import { useEffect, useRef, useState, type FormEvent } from 'react'

import { ErrorSummary, type ErrorSummaryItem } from '@/components/form/ErrorSummary'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { MAX_IMAGES, validateGame } from '@/features/games/validation'
import type { GameField, GameFieldErrors, GameValues } from '@/features/games/types'
import { useI18n, type MessageKey } from '@/i18n/context'

const EMPTY_VALUES: GameValues = { name: '', description: '', images: [] }

interface GameFormProps {
  initial?: GameValues
  submitLabel: string
  busy: boolean
  // Erreurs renvoyées par le serveur (ex. 409 sur le nom) et message global.
  serverErrors?: Partial<Record<GameField, MessageKey>>
  formError?: MessageKey | null
  onSubmit: (values: GameValues) => void
  onCancel: () => void
}

const IDS: Record<GameField, string> = {
  name: 'game-name',
  description: 'game-description',
  images: 'game-image-0',
}

export function GameForm({
  initial = EMPTY_VALUES,
  submitLabel,
  busy,
  serverErrors,
  formError,
  onSubmit,
  onCancel,
}: GameFormProps) {
  const { t } = useI18n()
  const summaryRef = useRef<HTMLDivElement>(null)
  const [values, setValues] = useState<GameValues>(initial)
  const [errors, setErrors] = useState<GameFieldErrors>({})
  // Focus demandé par une action (résumé d'erreurs, champ déplacé…) : appliqué après
  // le rendu, sans état supplémentaire.
  const focusTarget = useRef<string | 'summary' | null>(null)

  useEffect(() => {
    const target = focusTarget.current
    if (!target) return
    focusTarget.current = null
    if (target === 'summary') summaryRef.current?.focus()
    else document.getElementById(target)?.focus()
  })

  // Une erreur renvoyée par le serveur ramène le focus sur le résumé.
  useEffect(() => {
    if ((serverErrors && Object.keys(serverErrors).length > 0) || formError) {
      summaryRef.current?.focus()
    }
  }, [serverErrors, formError])

  const setImages = (images: string[]) => setValues((current) => ({ ...current, images }))

  function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    const found = validateGame(values)
    setErrors(found)
    if (Object.keys(found).length > 0) {
      focusTarget.current = 'summary'
      return
    }
    onSubmit(values)
  }

  const messages: Partial<Record<GameField, string>> = {}
  for (const field of Object.keys(IDS) as GameField[]) {
    const key = errors[field] ?? serverErrors?.[field]
    if (key) messages[field] = t(key)
  }
  const items: ErrorSummaryItem[] = [
    ...(Object.keys(IDS) as GameField[]).flatMap((field) =>
      messages[field] ? [{ fieldId: IDS[field], message: messages[field] }] : [],
    ),
    ...(formError ? [{ message: t(formError) }] : []),
  ]
  const descriptionLength = Array.from(values.description).length

  const describe = (field: GameField, extra?: string) =>
    [extra, messages[field] ? `${IDS[field]}-error` : null].filter(Boolean).join(' ') || undefined

  return (
    <form onSubmit={submit} noValidate aria-busy={busy} className="grid gap-6">
      <ErrorSummary
        ref={summaryRef}
        items={items}
        title={t('games.validation.fixErrors')}
      />
      <p className="text-sm text-muted-foreground">{t('games.formHint')}</p>

      <div className="grid gap-2">
        <Label htmlFor={IDS.name}>{t('games.name')}</Label>
        <Input
          id={IDS.name}
          value={values.name}
          required
          autoComplete="off"
          aria-invalid={messages.name ? true : undefined}
          aria-describedby={describe('name')}
          onChange={(event) => setValues({ ...values, name: event.target.value })}
        />
        {messages.name ? (
          <p id="game-name-error" className="text-sm text-destructive">
            <span className="font-medium">{t('common.error')}</span> {messages.name}
          </p>
        ) : null}
      </div>

      <div className="grid gap-2">
        <Label htmlFor={IDS.description}>{t('games.descriptionField')}</Label>
        <Textarea
          id={IDS.description}
          value={values.description}
          aria-invalid={messages.description ? true : undefined}
          aria-describedby={describe('description', 'game-description-count')}
          onChange={(event) => setValues({ ...values, description: event.target.value })}
        />
        <p id="game-description-count" className="text-sm text-muted-foreground">
          {t('games.descriptionCount', { count: descriptionLength })}
        </p>
        {messages.description ? (
          <p id="game-description-error" className="text-sm text-destructive">
            <span className="font-medium">{t('common.error')}</span> {messages.description}
          </p>
        ) : null}
      </div>

      <fieldset className="grid gap-3" aria-describedby={describe('images', 'game-images-hint')}>
        <legend className="mb-1 text-sm font-medium">{t('games.images')}</legend>
        <p id="game-images-hint" className="text-sm text-muted-foreground">
          {t('games.imagesHint')}
        </p>
        {values.images.map((url, index) => {
          const number = index + 1
          return (
            <div key={index} className="flex flex-wrap items-center gap-2">
              <Label htmlFor={`game-image-${index}`} className="sr-only">
                {t('games.imageNumber', { number })}
              </Label>
              <Input
                id={`game-image-${index}`}
                type="url"
                inputMode="url"
                value={url}
                placeholder="https://"
                autoComplete="off"
                aria-invalid={messages.images ? true : undefined}
                className="min-w-0 flex-1 basis-56"
                onChange={(event) =>
                  setImages(values.images.map((item, i) => (i === index ? event.target.value : item)))
                }
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label={t('games.moveUp', { number })}
                disabled={index === 0}
                onClick={() => {
                  const next = [...values.images]
                  ;[next[index - 1], next[index]] = [next[index], next[index - 1]]
                  setImages(next)
                  focusTarget.current = `game-image-${index - 1}`
                }}
              >
                <Icon icon={ArrowUp01Icon} />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label={t('games.moveDown', { number })}
                disabled={index === values.images.length - 1}
                onClick={() => {
                  const next = [...values.images]
                  ;[next[index + 1], next[index]] = [next[index], next[index + 1]]
                  setImages(next)
                  focusTarget.current = `game-image-${index + 1}`
                }}
              >
                <Icon icon={ArrowDown01Icon} />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label={t('games.removeImage', { number })}
                onClick={() => {
                  setImages(values.images.filter((_, i) => i !== index))
                  focusTarget.current = index > 0 ? `game-image-${index - 1}` : 'game-add-image'
                }}
              >
                <Icon icon={Cancel01Icon} />
              </Button>
            </div>
          )
        })}
        {messages.images ? (
          <p id="game-image-0-error" className="text-sm text-destructive">
            <span className="font-medium">{t('common.error')}</span> {messages.images}
          </p>
        ) : null}
        <div>
          <Button
            id="game-add-image"
            type="button"
            variant="outline"
            disabled={values.images.length >= MAX_IMAGES}
            onClick={() => {
              setImages([...values.images, ''])
              focusTarget.current = `game-image-${values.images.length}`
            }}
          >
            <Icon icon={Add01Icon} />
            {t('games.addImage')}
          </Button>
        </div>
      </fieldset>

      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={busy}>
          {busy ? t('games.saving') : submitLabel}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
      </div>
    </form>
  )
}
