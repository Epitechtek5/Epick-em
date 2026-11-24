import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type { TournamentImportPreview } from '@/features/tournaments/import-preview'
import { ImportPreviewPanel } from './ImportPreviewPanel'

const FILE = { name: 'big.json', format: 'json' as const, bytes: new Uint8Array([1]) }

function preview(matches: number): TournamentImportPreview {
  return {
    preview_id: 'p1',
    expires_in: 600,
    valid: true,
    requires_confirmation: false,
    warnings: [],
    errors: [],
    tournaments: [
      {
        game: 'Alpha Quest',
        name: 'Big Cup',
        action: 'create',
        destructive: false,
        changes: [{ resource: 'matches', action: 'create', before: 0, after: matches }],
        downstream: [],
        steps: [
          {
            position: 1,
            status: 'pending',
            groups: [],
            matches: Array.from({ length: matches }, (_, index) => ({
              index: index + 1,
              status: 'scheduled',
              next: null,
              participants: [{ name: `p${index}`, points: 0, rank: null, result: null }],
            })),
          },
        ],
      },
    ],
  }
}

function renderPanel(data: TournamentImportPreview | null, onConfirm = vi.fn()) {
  render(
    <ImportPreviewPanel
      preview={{ file: FILE, data }}
      busy={false}
      applying={false}
      onConfirm={onConfirm}
      onCancel={vi.fn()}
      onRefresh={vi.fn()}
    />,
  )
  return onConfirm
}

it('place le focus sur le titre de l’aperçu', () => {
  renderPanel(preview(1))
  expect(screen.getByRole('heading', { level: 2, name: 'Aperçu de l’import' })).toHaveFocus()
})

it('pagine les matchs d’un gros fichier', async () => {
  const user = userEvent.setup()
  renderPanel(preview(23))
  await user.click(screen.getByText('Étape 1 (En attente)'))
  expect(screen.getByText('Étape en attente : aucun placement.')).toBeInTheDocument()
  expect(screen.getByText('Matchs : 23')).toBeInTheDocument()
  expect(screen.getAllByText(/^Match \d+$/)).toHaveLength(10)

  await user.click(screen.getByRole('button', { name: 'Afficher plus (13 restants)' }))
  expect(screen.getAllByText(/^Match \d+$/)).toHaveLength(20)
  await user.click(screen.getByRole('button', { name: 'Afficher plus (3 restants)' }))
  expect(screen.getAllByText(/^Match \d+$/)).toHaveLength(23)
  expect(screen.queryByRole('button', { name: /Afficher plus/ })).not.toBeInTheDocument()
})

it('ne confirme pas un aperçu périmé : il propose de le refaire', () => {
  renderPanel(null)
  const panel = screen.getByRole('region', { name: 'Aperçu de l’import' })
  expect(within(panel).getByText(/n’est plus valable/)).toBeInTheDocument()
  expect(within(panel).getByRole('button', { name: 'Refaire l’aperçu' })).toBeEnabled()
  expect(within(panel).queryByRole('button', { name: 'Confirmer l’import' })).not.toBeInTheDocument()
})

it('confirme sans opération destructive à accepter', async () => {
  const user = userEvent.setup()
  const onConfirm = renderPanel(preview(1))
  await user.click(screen.getByRole('button', { name: 'Confirmer l’import' }))
  expect(onConfirm).toHaveBeenCalledWith(false)
})
