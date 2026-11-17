// Non-régression d'accessibilité : axe-core (règles WCAG 2.1 A/AA et bonnes pratiques) sur les
// écrans des parcours critiques — connexion, inscription, mot de passe oublié, accueil, tournois,
// étape, tableau et match.
//
// jsdom ne calcule ni la mise en page ni les couleurs : le contraste (`color-contrast`) et ce qui
// dépend du rendu réel restent couverts par l'audit manuel (docs/qualite-et-performance.md).
import { cleanup, screen } from '@testing-library/react'
import axe from 'axe-core'

import type { Tournament } from '@/features/tournaments/types'
import {
  ELIM_GROUPS,
  ELIM_ONGOING,
  elimBracket,
  makeMatch,
  participant,
  POOL_GROUPS,
  POOLS_ONGOING,
  SEMI_1_ID,
} from '@/test/matches'
import { GAME_A, jsonResponse, renderApp, routeFetch, signInAs, STAT_A, userResponse } from '@/test/render'
import { P_BOB, P_ME, RULE_LINEAR, SOLO } from '@/test/tournaments'

const ONGOING: Tournament = { ...SOLO, status: 'ongoing' }
const base = `/tournaments/${ONGOING.id}`
const POOL_MATCH = makeMatch({
  step_id: POOLS_ONGOING.id,
  status: 'finished',
  participants: [
    participant('pool', P_ME.id, { stats: { kills: 3 }, points: 6, rank: 1, result: 'win' }),
    participant('pool', P_BOB.id, { stats: { kills: 1 }, points: 2, rank: 2, result: 'loss' }),
  ],
})

// API simulée en lecture seule, suffisante pour afficher chaque écran.
function readOnlyApi() {
  routeFetch((path) => {
    const user = userResponse(path)
    if (user) return user
    if (path.startsWith('/tournaments?') || path === '/tournaments') return jsonResponse(200, [ONGOING])
    if (path.startsWith('/games')) {
      if (path === `/games/${GAME_A.id}/stats`) return jsonResponse(200, [STAT_A])
      if (path === `/games/${GAME_A.id}`) return jsonResponse(200, GAME_A)
      return jsonResponse(200, [GAME_A])
    }
    if (path === base) return jsonResponse(200, ONGOING)
    if (path === `${base}/scoring-rules`) return jsonResponse(200, [RULE_LINEAR])
    if (path.startsWith(`${base}/participants`)) return jsonResponse(200, [P_ME, P_BOB])
    if (path.startsWith(`${base}/teams`)) return jsonResponse(200, [])
    if (path === `${base}/steps`) return jsonResponse(200, [POOLS_ONGOING, ELIM_ONGOING])
    if (path === `${base}/ranking`) return jsonResponse(200, [])
    const ranking = /\/steps\/([0-9a-f-]+)\/ranking$/.exec(path)
    if (ranking) return jsonResponse(200, ranking[1] === ELIM_ONGOING.id ? ELIM_GROUPS : POOL_GROUPS)
    const one = /\/steps\/([0-9a-f-]+)\/matches\/([0-9a-f-]+)$/.exec(path)
    if (one) {
      const all = one[1] === ELIM_ONGOING.id ? elimBracket() : [POOL_MATCH]
      const found = all.find((m) => m.id === one[2])
      return found ? jsonResponse(200, found) : jsonResponse(404, { error: 'not_found' })
    }
    const list = /\/steps\/([0-9a-f-]+)\/matches(\?.*)?$/.exec(path)
    if (list) return jsonResponse(200, list[1] === ELIM_ONGOING.id ? elimBracket() : [POOL_MATCH])
    if (path.startsWith('/users') || path.startsWith('/teams')) return jsonResponse(200, [])
    return jsonResponse(404, { error: 'not_found' })
  })
}

async function violations() {
  const results = await axe.run(document.body, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] },
    rules: { 'color-contrast': { enabled: false } },
  })
  return results.violations.map((v) => ({
    rule: v.id,
    impact: v.impact,
    nodes: v.nodes.map((n) => n.target.join(' ')),
  }))
}

afterEach(() => cleanup())

describe('accessibilité des parcours critiques (axe-core)', () => {
  const publicScreens: Array<[string, string, RegExp]> = [
    ['connexion', '/login', /connexion/i],
    ['inscription', '/register', /inscription|créer/i],
    ['mot de passe oublié', '/forgot-password', /mot de passe/i],
  ]
  it.each(publicScreens)('%s', async (_, route, heading) => {
    readOnlyApi()
    renderApp(route)
    await screen.findByRole('heading', { level: 1, name: heading })
    expect(await violations()).toEqual([])
  })

  const signedInScreens: Array<[string, string, RegExp]> = [
    ['accueil', '/app', /bonjour/i],
    ['liste des tournois', '/tournaments', /tournois/i],
    ['détail du tournoi', base, new RegExp(ONGOING.name)],
    ['étape de poules', `${base}/steps/${POOLS_ONGOING.id}`, /étape 1/i],
    ['tableau d’élimination', `${base}/steps/${ELIM_ONGOING.id}/bracket`, /étape 2/i],
    ['détail d’un match', `${base}/steps/${ELIM_ONGOING.id}/matches/${SEMI_1_ID}`, /match/i],
  ]
  it.each(signedInScreens)('%s', async (_, route, heading) => {
    signInAs('user')
    readOnlyApi()
    renderApp(route)
    await screen.findByRole('heading', { level: 1, name: heading })
    // Laisse les chargements secondaires (classements, comptes) se terminer.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(await violations()).toEqual([])
  })
})
