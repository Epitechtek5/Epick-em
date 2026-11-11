// Tournoi en direct sous charge : des spectateurs consultent en continu le tournoi, ses
// classements et ses matchs pendant qu'un arbitre saisit les résultats ; on mesure la latence des
// lectures et le délai entre la fin d'un match et sa prise en compte dans le classement.
//
// Lancé par `loadtest/run-local.sh` (environnement isolé) ; ne jamais viser la production.
//
// Variables : BASE_URL (défaut http://localhost:18080), ADMIN_EMAIL, PASSWORD, SPECTATORS (comptes
// spectateurs `spectator<i>@load.test`, vérifiés par le script de lancement), PLAYERS (identifiants
// des joueurs, séparés par des virgules), GROUPS, MATCHES_PER_GROUP, PEAK_VUS, DURATION, RESULTS_RATE,
// SUMMARY (fichier du résumé JSON).
import http from 'k6/http'
import { check, fail, sleep } from 'k6'
import exec from 'k6/execution'
import { Counter, Trend } from 'k6/metrics'

const BASE = __ENV.BASE_URL || 'http://localhost:18080'
const PASSWORD = __ENV.PASSWORD || 'loadtest-password'
const SPECTATORS = Number(__ENV.SPECTATORS || 50)
const GROUPS = Number(__ENV.GROUPS || 8)
const GROUP_SIZE = 8
const MATCHES_PER_GROUP = Number(__ENV.MATCHES_PER_GROUP || 10)
const PEAK_VUS = Number(__ENV.PEAK_VUS || 200)
const DURATION = __ENV.DURATION || '3m'
const RESULTS_RATE = Number(__ENV.RESULTS_RATE || 1)

const readLatency = new Trend('spectator_read_ms', true)
const propagation = new Trend('ranking_propagation_ms', true)
const finishLatency = new Trend('result_submission_ms', true)
const staleReads = new Counter('ranking_stale_polls')

export const options = {
  scenarios: {
    spectators: {
      executor: 'ramping-vus',
      exec: 'spectate',
      startVUs: 0,
      stages: [
        { duration: '30s', target: PEAK_VUS },
        { duration: DURATION, target: PEAK_VUS },
        { duration: '15s', target: 0 },
      ],
      gracefulRampDown: '10s',
    },
    results: {
      executor: 'constant-arrival-rate',
      exec: 'referee',
      rate: RESULTS_RATE,
      timeUnit: '1s',
      duration: DURATION,
      startTime: '30s',
      preAllocatedVUs: 4,
      maxVUs: 8,
    },
  },
  // Seuils (voir docs/exploitation/tests-de-charge.md) : leur dépassement fait échouer le run.
  // Un seuil sur une métrique sans échantillon passe : `checks` et les compteurs du résumé
  // permettent de vérifier que chaque scénario a bien tourné.
  thresholds: {
    checks: ['rate>0.99'],
    http_req_failed: ['rate<0.01'],
    'spectator_read_ms': ['p(95)<300', 'p(99)<800'],
    'result_submission_ms': ['p(95)<500'],
    'ranking_propagation_ms': ['p(95)<1000'],
  },
  summaryTrendStats: ['min', 'med', 'avg', 'p(90)', 'p(95)', 'p(99)', 'max'],
}

const json = (token) => ({
  headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
})

function login(email) {
  const res = http.post(`${BASE}/login`, JSON.stringify({ email, password: PASSWORD }), json())
  if (res.status !== 200) fail(`connexion de ${email} : ${res.status} ${res.body}`)
  return res.json('access_token')
}

function must(res, status, what) {
  if (res.status !== status) fail(`${what} : ${res.status} ${res.body}`)
  return res.body ? res.json() : null
}

// Prépare un tournoi en cours : une étape de poules FFA de GROUPS groupes de 8 joueurs, avec
// MATCHES_PER_GROUP matchs par groupe, prêts à recevoir leurs résultats (puis une finale, exigée
// par les règles de chaînage des étapes ; elle n'est pas jouée ici).
export function setup() {
  const admin = login(__ENV.ADMIN_EMAIL)
  const players = (__ENV.PLAYERS || '').split(',').filter(Boolean)
  if (players.length !== GROUPS * GROUP_SIZE) fail(`il faut ${GROUPS * GROUP_SIZE} joueurs, reçu ${players.length}`)
  const tag = `${Date.now()}`
  const game = must(http.post(`${BASE}/games`, JSON.stringify({ name: `Charge ${tag}` }), json(admin)), 201, 'jeu')
  const stat = must(
    http.post(`${BASE}/stats`, JSON.stringify({ name: `Kills ${tag}`, key: `kills_${tag}`, type: 'flat' }), json(admin)),
    201,
    'statistique',
  )
  must(http.put(`${BASE}/games/${game.id}/stats/${stat.id}`, null, json(admin)), 204, 'liaison')
  const tournament = must(
    http.post(
      `${BASE}/tournaments`,
      JSON.stringify({
        game_id: game.id,
        name: `Tournoi de charge ${tag}`,
        start_date: '2026-11-14T18:00:00Z',
        end_date: '2026-11-15T18:00:00Z',
        participant_type: 'solo',
        max_participants: GROUPS * GROUP_SIZE,
      }),
      json(admin),
    ),
    201,
    'tournoi',
  )
  const t = `${BASE}/tournaments/${tournament.id}`
  must(http.post(`${t}/scoring-rules`, JSON.stringify({ stat_id: stat.id, mode: 'linear', coefficient: 1 }), json(admin)), 201, 'barème')
  const step = must(
    http.post(
      `${t}/steps`,
      JSON.stringify({
        position: 1,
        format: 'pool',
        match_type: 'ffa',
        group_count: GROUPS,
        group_size: GROUP_SIZE,
        matches_per_group: MATCHES_PER_GROUP,
        advance_per_group: 1,
      }),
      json(admin),
    ),
    201,
    'étape',
  )
  // Finale : les GROUPS qualifiés (un par poule) en un groupe ; le dernier tour n'en qualifie qu'un.
  must(
    http.post(
      `${t}/steps`,
      JSON.stringify({
        position: 2,
        format: 'pool',
        match_type: 'ffa',
        group_count: 1,
        group_size: GROUPS,
        matches_per_group: 1,
        advance_per_group: 1,
      }),
      json(admin),
    ),
    201,
    'finale',
  )
  must(http.post(`${t}/status`, JSON.stringify({ status: 'registration' }), json(admin)), 200, 'inscriptions')
  for (const user_id of players) {
    must(http.post(`${t}/participants`, JSON.stringify({ user_id }), json(admin)), 201, 'inscription')
  }
  must(http.post(`${t}/status`, JSON.stringify({ status: 'ongoing' }), json(admin)), 200, 'lancement')
  must(http.post(`${t}/steps/${step.id}/start`, '{}', json(admin)), 200, 'étape lancée')
  const groups = must(http.get(`${t}/steps/${step.id}/ranking`, json(admin)), 200, 'classement')
  const matches = []
  for (const group of groups) {
    const ids = group.participants.map((p) => p.participant_id)
    for (let i = 0; i < MATCHES_PER_GROUP; i += 1) {
      const m = must(
        http.post(`${t}/steps/${step.id}/matches`, JSON.stringify({ group_id: group.group_id, participant_ids: ids }), json(admin)),
        201,
        'match',
      )
      matches.push({ id: m.id, participants: ids })
    }
  }
  const spectators = []
  for (let i = 0; i < SPECTATORS; i += 1) spectators.push(login(`spectator${i}@load.test`))
  return { admin, tournament: tournament.id, step: step.id, statKey: stat.key, matches, spectators }
}

// Un spectateur : la page du tournoi, puis le classement de l'étape et la liste des matchs, avec
// le temps de lecture d'un humain entre deux rafraîchissements.
export function spectate(data) {
  const token = data.spectators[exec.vu.idInTest % data.spectators.length]
  const t = `${BASE}/tournaments/${data.tournament}`
  for (const url of [t, `${t}/steps/${data.step}/ranking`, `${t}/steps/${data.step}/matches`, `${t}/ranking`]) {
    const res = http.get(url, { ...json(token), tags: { name: url.replace(data.tournament, '{id}').replace(data.step, '{step}') } })
    readLatency.add(res.timings.duration)
    check(res, { 'lecture 200': (r) => r.status === 200 })
  }
  sleep(1 + Math.random())
}

// L'arbitre : saisit les résultats d'un match, le termine, puis relit le classement jusqu'à y voir
// les nouveaux points ; le délai mesuré va de l'envoi de la fin du match à cette lecture.
export function referee(data) {
  const index = exec.scenario.iterationInTest
  if (index >= data.matches.length) return
  const match = data.matches[index]
  const base = `${BASE}/tournaments/${data.tournament}/steps/${data.step}`
  const results = match.participants.map((participant_id, rank) => ({
    participant_id,
    stats: { [data.statKey]: GROUP_SIZE - rank },
    rank: rank + 1,
  }))
  const saved = http.put(`${base}/matches/${match.id}/results`, JSON.stringify({ results }), {
    ...json(data.admin),
    tags: { name: 'PUT results' },
  })
  check(saved, { 'résultats 200': (r) => r.status === 200 })
  const leader = match.participants[0]
  const before = pointsOf(data, base, leader)
  const started = Date.now()
  const done = http.post(`${base}/matches/${match.id}/status`, JSON.stringify({ status: 'finished' }), {
    ...json(data.admin),
    tags: { name: 'POST finish' },
  })
  finishLatency.add(done.timings.duration)
  if (!check(done, { 'fin de match 200': (r) => r.status === 200 })) return
  for (let poll = 0; poll < 50; poll += 1) {
    if (pointsOf(data, base, leader) >= before + GROUP_SIZE) {
      propagation.add(Date.now() - started)
      return
    }
    staleReads.add(1)
    sleep(0.05)
  }
}

function pointsOf(data, base, participant) {
  const res = http.get(`${base}/ranking`, { ...json(data.admin), tags: { name: 'GET step ranking (arbitre)' } })
  for (const group of res.json() || []) {
    const found = group.participants.find((p) => p.participant_id === participant)
    if (found) return found.points
  }
  return 0
}

export function handleSummary(summary) {
  const out = { stdout: textSummary(summary) }
  if (__ENV.SUMMARY) out[__ENV.SUMMARY] = JSON.stringify(summary, null, 2)
  return out
}

function textSummary(summary) {
  const lines = ['', 'Résumé :']
  for (const name of ['checks', 'http_reqs', 'http_req_failed', 'spectator_read_ms', 'result_submission_ms', 'ranking_propagation_ms', 'ranking_stale_polls', 'vus_max', 'iterations']) {
    const metric = summary.metrics[name]
    if (metric) lines.push(`  ${name}: ${JSON.stringify(metric.values)}`)
  }
  for (const [name, metric] of Object.entries(summary.metrics)) {
    if (metric.thresholds) {
      for (const [rule, result] of Object.entries(metric.thresholds)) lines.push(`  seuil ${name} ${rule} : ${result.ok ? 'OK' : 'DÉPASSÉ'}`)
    }
  }
  return `${lines.join('\n')}\n`
}
