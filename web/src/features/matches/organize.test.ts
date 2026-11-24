import { elimBracket, FINAL_ID, GROUP_A, GROUP_B, makeMatch, participant, POOL_GROUPS, SEMI_1_ID, SEMI_2_ID } from '@/test/matches'
import { P_BOB, P_ME } from '@/test/tournaments'
import {
  byGroupAndRound,
  byRegion,
  byRound,
  feeders,
  isBye,
  isFinalReset,
  layoutBracket,
  matchNumbers,
  openSlots,
  orderedParticipants,
  predecessors,
} from './organize'

describe('organisation des matchs', () => {
  it('numérote dans l’ordre du serveur et range par groupe puis par tour', () => {
    const matches = [
      makeMatch({ group_id: GROUP_B, round: 1 }),
      makeMatch({ group_id: GROUP_A, round: 2 }),
      makeMatch({ group_id: GROUP_A, round: null }),
      makeMatch({ group_id: GROUP_A, round: 1 }),
    ]
    expect([...matchNumbers(matches).values()]).toEqual([1, 2, 3, 4])
    const blocks = byGroupAndRound(matches, POOL_GROUPS)
    expect(blocks.map((block) => block.index)).toEqual([1, 2])
    expect(blocks[0].rounds.map((round) => round.round)).toEqual([1, 2, null])
    expect(byRound(matches).map((round) => round.matches.length)).toEqual([2, 1, 1])
  })

  it('sépare les tableaux de double élimination', () => {
    const matches = [makeMatch({ bracket: 'grand_final' }), makeMatch({ bracket: 'winners' }), makeMatch({ bracket: 'losers' })]
    expect(byRegion(matches).map((region) => region.region)).toEqual(['winners', 'losers', 'grand_final'])
  })

  it('montre les places libres d’après les liens du serveur, sans inventer de vainqueur', () => {
    const matches = elimBracket()
    const incoming = predecessors(matches)
    const final = matches.find((match) => match.id === FINAL_ID)!
    expect(incoming.get(FINAL_ID)?.map((match) => match.id)).toEqual([SEMI_1_ID, SEMI_2_ID])
    // Le vainqueur de la demi-finale terminée est déjà placé par le serveur ; l'autre est attendu.
    expect(openSlots(final, incoming.get(FINAL_ID)!, 2)).toEqual([{ kind: 'winnerOf', match: matches[1] }])
    expect(openSlots(matches[1], [], 2)).toEqual([{ kind: 'pending' }])
    expect(openSlots(matches[0], [], 2)).toEqual([])
  })

  it('dispose le tableau par tour et relie les matchs par next_match_id', () => {
    const layout = layoutBracket(elimBracket(), 2)
    const at = (id: string) => layout.nodes.find((node) => node.match.id === id)!
    expect(at(SEMI_1_ID).x).toBe(at(SEMI_2_ID).x)
    expect(at(FINAL_ID).x).toBeGreaterThan(at(SEMI_1_ID).x)
    // La finale est centrée entre les deux matchs qui l'alimentent.
    const center = (id: string) => at(id).y + at(id).height / 2
    expect(center(FINAL_ID)).toBe((center(SEMI_1_ID) + center(SEMI_2_ID)) / 2)
    expect(layout.edges.map((edge) => [edge.from, edge.to])).toEqual([
      [SEMI_1_ID, FINAL_ID],
      [SEMI_2_ID, FINAL_ID],
    ])
  })

  it('montre un tableau incomplet tel quel : aucun lien inventé', () => {
    const layout = layoutBracket([makeMatch({ round: 1 }), makeMatch({ round: 2 })], 2)
    expect(layout.nodes).toHaveLength(2)
    expect(layout.edges).toEqual([])
  })

  it('suit les liens du perdant en double élimination, places comprises', () => {
    const final = makeMatch({ bracket: 'grand_final', round: 1 })
    const reset = makeMatch({ bracket: 'grand_final', round: 2 })
    const winners = makeMatch({ bracket: 'winners', round: 1, number: 1, next_match_id: final.id, next_slot: 1 })
    const losers = makeMatch({
      bracket: 'losers',
      round: 1,
      number: 1,
      next_match_id: final.id,
      next_slot: 2,
    })
    const feeding = makeMatch({ bracket: 'winners', round: 1, number: 2, loser_next_match_id: losers.id, loser_next_slot: 2 })
    const finalWithLinks = { ...final, next_match_id: reset.id, next_slot: 1, loser_next_match_id: reset.id, loser_next_slot: 2 }
    const matches = [winners, feeding, losers, finalWithLinks, reset]
    const incoming = feeders(matches)
    expect(incoming.get(final.id)?.map((feed) => [feed.match.id, feed.kind, feed.slot])).toEqual([
      [winners.id, 'winner', 1],
      [losers.id, 'winner', 2],
    ])
    expect(openSlots(losers, incoming.get(losers.id)!, 2)).toEqual([{ kind: 'loserOf', match: feeding }, { kind: 'pending' }])
    // La manche de reset attend le vainqueur puis le perdant de la grande finale.
    expect(openSlots(reset, incoming.get(reset.id)!, 2)).toEqual([
      { kind: 'winnerOf', match: finalWithLinks },
      { kind: 'loserOf', match: finalWithLinks },
    ])
    expect(isFinalReset(reset)).toBe(true)
    expect(isFinalReset(final)).toBe(false)
    const layout = layoutBracket(matches, 2)
    expect(layout.edges.filter((edge) => edge.kind === 'loser').map((edge) => [edge.from, edge.to])).toEqual([
      [feeding.id, losers.id],
      [finalWithLinks.id, reset.id],
    ])
  })

  it('reconnaît un bye et range les participants par emplacement', () => {
    const bye = makeMatch({ status: 'finished' })
    bye.participants = [participant(bye.id, P_ME.id, { result: 'win', rank: 1 })]
    expect(isBye(bye)).toBe(true)
    expect(isBye(makeMatch())).toBe(false)
    const seated = makeMatch()
    seated.participants = [participant(seated.id, P_BOB.id, { slot: 2 }), participant(seated.id, P_ME.id, { slot: 1 })]
    expect(orderedParticipants(seated).map((p) => p.participant_id)).toEqual([P_ME.id, P_BOB.id])
  })
})
