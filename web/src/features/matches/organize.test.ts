import { elimBracket, FINAL_ID, GROUP_A, GROUP_B, makeMatch, POOL_GROUPS, SEMI_1_ID, SEMI_2_ID } from '@/test/matches'
import { byGroupAndRound, byRegion, byRound, layoutBracket, matchNumbers, openSlots, predecessors } from './organize'

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
})
