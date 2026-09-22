import { mainPotShares, mainPotSharesBySubset, type Card } from '@ab/engine'
import { describe, expect, it } from 'vitest'
import { extractHands, type DecisionRecord } from '../src/hands'
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

  it('can estimate instead of enumerating, for screens that need the whole log quickly', async () => {
    const [hand] = extractHands(await playFixedHand([caller('a'), caller('b'), caller('c')], [['Ah', 'Ad'], ['Kh', 'Kd'], ['Qh', 'Qd']], board))
    const exact = scoreDecisions([hand!])
    const sampled = scoreDecisions([hand!], new Map(), { maxEvaluations: 1000, samples: 20_000, seedNamespace: 'test' })
    const preflop = (xs: typeof exact) => xs.find((d) => d.street === 'preflop' && d.playerId === 'a')!.expectedShare
    expect(preflop(sampled)).toBeCloseTo(preflop(exact), 2) // within a percentage point of the truth
    expect(preflop(sampled)).not.toBe(preflop(exact)) // it really did sample
    // Same seed, same estimate; and the river, where enumeration is trivial, stays exact.
    expect(scoreDecisions([hand!], new Map(), { maxEvaluations: 1000, samples: 20_000, seedNamespace: 'test' }).map((d) => d.expectedShare)).toEqual(sampled.map((d) => d.expectedShare))
    for (const d of sampled.filter((x) => x.street === 'river')) expect(d.expectedShare).toBe(d.playerId === 'a' ? 1 : 0)
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

  it('scores two live sets of one deal and board in the same pass', async () => {
    // a opens, b folds, c calls: preflop decisions see {a, b, c} and then {a, c}.
    const opener = scripted('a', (o) => (o.street === 'preflop' ? 'open_3bb' : undefined))
    const folder = scripted('b', () => 'fold')
    const [hand] = extractHands(await playFixedHand([opener, folder, caller('c')], [['Ah', 'Kd'], ['Qh', 'Qd'], ['7s', '6s']], board))
    const holes = [cards('Ah Kd'), cards('Qh Qd'), cards('7s 6s')]
    const [all, headsUp] = mainPotSharesBySubset(holes, [], [[0, 1, 2], [0, 2]])
    const scored = scoreDecisions([hand!])
    const pre = scored.filter((d) => d.street === 'preflop')
    expect(pre.map((d) => [d.playerId, d.live.length])).toEqual([
      ['a', 3],
      ['b', 3],
      ['c', 2],
    ])
    expect(pre[0]!.expectedShare).toBeCloseTo(all![0]!, 12)
    expect(pre[1]!.expectedShare).toBeCloseTo(all![1]!, 12)
    expect(pre[2]!.expectedShare).toBeCloseTo(headsUp![1]!, 12)
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
    // b folds a weak hand to a flop bet (right, by equity); c calls the flop bet with kings behind aces
    // (wrong, by equity). Checks are scored by the chips that followed: c's preflop and flop checks led
    // to chips lost, its turn and river checks cost nothing more.
    const bettor = scripted('a', (o) => (o.street === 'flop' ? 'pot_50' : undefined))
    const folder = scripted('b', (o) => (o.street === 'flop' ? 'fold' : undefined))
    const [hand] = extractHands(await playFixedHand([bettor, folder, caller('c')], [['Ah', 'Ad'], ['3h', '8d'], ['Kh', 'Kd']], board))
    const scored = scoreDecisions([hand!])
    const fold = scored.find((d) => d.actionType === 'fold')!
    expect(fold.expectedShare).toBeLessThan(fold.toCall / (fold.winnablePot + fold.toCall))
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

  it('scores calls by equity too, and uses the pot the player can actually win', () => {
    const base = scoreDecisionsStub()
    // Facing a 950 all-in call with only 1,150 winnable (a short stack), 30% equity is not enough to call...
    const shortCall = { ...base, actionType: 'call' as const, toCall: 950, pot: 10_150, winnablePot: 1_150 }
    expect(actionGood(shortCall, 0.3)).toBe(0) // pot odds 950 / 2,100 = 45%
    expect(actionGood(shortCall, 0.5)).toBe(1)
    // ...and folding it is right, although the raw pot (10,150) would suggest 9% odds.
    expect(actionGood({ ...shortCall, actionType: 'fold' }, 0.3)).toBe(1)
  })
})

/** A minimal decision record for scoring rules (only the fields actionGood reads matter). */
function scoreDecisionsStub(): DecisionRecord {
  return {
    handId: 'x', index: 0, playerId: 'p', street: 'preflop', position: 'SB', model: 'm', optionId: 'call', actionType: 'call',
    chipsIn: 0, pot: 0, winnablePot: 0, toCall: 0, stackBefore: 0, board: [], live: ['p', 'q'], winProbability: null, confidence: null,
    optionProbabilities: null, latencyMs: 0, inputTokens: 0, outputTokens: 0, reasoningTokens: 0, costUsd: 0, retries: 0,
    fallback: false, fallbackKind: null, mainPotShare: 0, stackChange: 0,
  }
}
