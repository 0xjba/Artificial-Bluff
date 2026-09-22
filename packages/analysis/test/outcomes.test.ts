import { mainPotShares, mainPotSharesBySubset, type Card } from '@ab/engine'
import { describe, expect, it } from 'vitest'
import { extractHands } from '../src/hands'
import { actionGood, scoreDecisions, type ShareCache } from '../src/outcomes'
import { playFixedHand, scripted } from './helpers'

const caller = (id: string) => scripted(id, () => undefined)
const board = ['2c', '7d', '9h', 'Js', '4c']
const cards = (s: string) => s.split(' ') as Card[]

describe('outcome C: expected main-pot share at the decision', () => {
  it('is the exact all-in equity of the live players, and 0 or 1 once the river is out', async () => {
    const [hand] = extractHands(await playFixedHand([caller('a'), caller('b'), caller('c')], [['Ah', 'Ad'], ['Kh', 'Kd'], ['Qh', 'Qd']], board))
    const scored = scoreDecisions([hand!])
    const preflopA = scored[0]!
    expect(preflopA.expectedShare).toBeCloseTo(mainPotShares([cards('Ah Ad'), cards('Kh Kd'), cards('Qh Qd')], [])[0]!, 12)
    for (const d of scored.filter((x) => x.street === 'river')) expect(d.expectedShare).toBe(d.playerId === 'a' ? 1 : 0)
  })

  it('reuses one enumeration for the same cards in different seats', async () => {
    const cache: ShareCache = new Map()
    const [h1] = extractHands(await playFixedHand([caller('a'), caller('b')], [['Ah', 'Ad'], ['Kh', 'Kd']], board, 'h1'))
    const [h2] = extractHands(await playFixedHand([caller('a'), caller('b')], [['Kh', 'Kd'], ['Ah', 'Ad']], board, 'h2'))
    const first = scoreDecisions([h1!], cache)[0]!.expectedShare
    const size = cache.size
    const mirrored = scoreDecisions([h2!], cache)[0]!.expectedShare // a now holds the kings
    expect(cache.size).toBe(size)
    expect(first + mirrored).toBeCloseTo(1, 12)
  })

  it("treats a folded player's cards as dead", async () => {
    // a (button, facing the big blind) folds two aces; b's later equity must not count on an ace coming.
    const folder = scripted('a', () => 'fold')
    const [hand] = extractHands(await playFixedHand([folder, caller('b'), caller('c')], [['As', 'Ac'], ['Ah', 'Kd'], ['Qh', 'Qd']], board))
    expect(hand!.folded).toEqual(['a'])
    const flopB = scoreDecisions([hand!]).find((d) => d.street === 'flop' && d.playerId === 'b')!
    const holes = [cards('As Ac'), cards('Ah Kd'), cards('Qh Qd')]
    expect(flopB.expectedShare).toBeCloseTo(mainPotSharesBySubset(holes, cards('2c 7d 9h'), [[1, 2]])[0]![0]!, 12)
    // Leaving the folded aces in the deck would overstate b's chances.
    expect(mainPotShares(holes.slice(1), cards('2c 7d 9h'))[0]!).toBeGreaterThan(flopB.expectedShare + 0.01)
  })
})

describe('per-action outcome', () => {
  it('scores a fold by all-in equity against the pot odds, other actions by the chips that followed', async () => {
    // b folds a weak hand to a flop bet (right); c calls the flop bet with kings and loses to aces (wrong),
    // but its turn and river checks cost nothing more, so they count as fine.
    const bettor = scripted('a', (o) => (o.street === 'flop' ? 'pot_50' : undefined))
    const folder = scripted('b', (o) => (o.street === 'flop' ? 'fold' : undefined))
    const [hand] = extractHands(await playFixedHand([bettor, folder, caller('c')], [['Ah', 'Ad'], ['3h', '8d'], ['Kh', 'Kd']], board))
    const scored = scoreDecisions([hand!])
    const fold = scored.find((d) => d.actionType === 'fold')!
    expect(fold.expectedShare).toBeLessThan(fold.toCall / (fold.pot + fold.toCall))
    expect(fold.actionGood).toBe(1)
    expect(scored.filter((d) => d.playerId === 'c').map((d) => [d.street, d.actionType, d.actionGood])).toEqual([
      ['preflop', 'check', 0],
      ['flop', 'check', 0],
      ['flop', 'call', 0],
      ['turn', 'check', 1],
      ['river', 'check', 1],
    ])
    expect(scored.filter((d) => d.playerId === 'a').every((d) => d.actionGood === 1)).toBe(true)
    // The same fold with the aces instead would have been wrong.
    expect(actionGood(fold, 0.9)).toBe(0)
  })
})
