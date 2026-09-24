import { fullDeck, rankOf, rankValue, RANKS, suitOf, type Card, type Rank } from './cards'
import { evaluateHand, type HandCategory } from './evaluate'
import { PREFLOP_EQUITY } from './preflop-table'

/**
 * What a player holds, in the words a player would use: facts computed from their own cards and the
 * board only (never anyone else's cards), the same for every model at the table.
 */
export interface HandFacts {
  /** The made hand ("one pair: kings (top pair, queen kicker)"), or before the flop the starting hand. */
  made: string
  /** Before the flop: the starting hand is in the top this-many percent of all 1,326 starting hands. */
  startingHandTopPct?: number
  /** On the flop and turn: straight and flush draws the player's own cards are part of. */
  draws?: string[]
  /** On the flop and turn: unseen cards that would give the player a straight or a flush. */
  outs?: number
}

const NAME: Record<Rank, [string, string]> = {
  A: ['ace', 'aces'],
  K: ['king', 'kings'],
  Q: ['queen', 'queens'],
  J: ['jack', 'jacks'],
  T: ['ten', 'tens'],
  '9': ['nine', 'nines'],
  '8': ['eight', 'eights'],
  '7': ['seven', 'sevens'],
  '6': ['six', 'sixes'],
  '5': ['five', 'fives'],
  '4': ['four', 'fours'],
  '3': ['three', 'threes'],
  '2': ['deuce', 'deuces'],
}

/** Every starting hand, strongest first, with how many of the 1,326 combinations it covers. */
const RANKED = Object.entries(PREFLOP_EQUITY)
  .map(([hand, equity]) => ({ hand, equity, combos: hand.length === 2 ? 6 : hand.endsWith('s') ? 4 : 12 }))
  .sort((a, b) => b.equity - a.equity)
const TOP_PCT = new Map<string, number>()
{
  let covered = 0
  for (const h of RANKED) {
    covered += h.combos
    TOP_PCT.set(h.hand, Math.ceil((covered / 1326) * 100))
  }
}

/** A starting hand's class ("AKs", "QQ", "72o"), its name, and how high it ranks. */
export function startingHand(hole: readonly Card[]): { hand: string; name: string; topPct: number } {
  const [a, b] = [...hole].sort((x, y) => rankValue(y) - rankValue(x)) as [Card, Card]
  const [ra, rb] = [rankOf(a), rankOf(b)]
  const pair = ra === rb
  const suited = suitOf(a) === suitOf(b)
  const hand = pair ? `${ra}${rb}` : `${ra}${rb}${suited ? 's' : 'o'}`
  const name = pair ? `a pair of ${NAME[ra][1]}` : `${NAME[ra][0]}-${NAME[rb][0]} ${suited ? 'suited' : 'offsuit'}`
  return { hand, name, topPct: TOP_PCT.get(hand)! }
}

const LABEL: Record<HandCategory, string> = {
  straight_flush: 'straight flush',
  four_of_a_kind: 'four of a kind',
  full_house: 'full house',
  flush: 'flush',
  straight: 'straight',
  three_of_a_kind: 'three of a kind',
  two_pair: 'two pair',
  one_pair: 'one pair',
  high_card: 'high card',
}
const DRAWN: ReadonlySet<HandCategory> = new Set(['straight', 'flush', 'straight_flush'])
const AT_LEAST_STRAIGHT: ReadonlySet<HandCategory> = new Set(['straight', 'flush', 'full_house', 'four_of_a_kind', 'straight_flush'])

/** Where a single pair sits: made with the board, in the hand, or only on the board. */
function pairDetail(hole: readonly Card[], board: readonly Card[]): string {
  const counts = new Map<Rank, number>()
  for (const card of [...hole, ...board]) counts.set(rankOf(card), (counts.get(rankOf(card)) ?? 0) + 1)
  const r = [...counts].find(([, n]) => n >= 2)![0]
  const boardRanks = [...new Set(board.map(rankOf))].sort((x, y) => RANKS.indexOf(y) - RANKS.indexOf(x))
  const holeRanks = hole.map(rankOf)
  const named = `one pair: ${NAME[r][1]}`
  if (holeRanks[0] === r && holeRanks[1] === r) return `${named} (${RANKS.indexOf(r) > RANKS.indexOf(boardRanks[0]!) ? 'overpair' : 'underpair'})`
  if (!holeRanks.includes(r)) {
    const high = [...holeRanks].sort((x, y) => RANKS.indexOf(y) - RANKS.indexOf(x))[0]!
    return `${named} (on the board), ${NAME[high][0]} high`
  }
  const at = boardRanks.indexOf(r)
  if (at === 0) {
    const kicker = holeRanks.find((x) => x !== r)!
    return `${named} (top pair, ${NAME[kicker][0]} kicker)`
  }
  return `${named} (${at === boardRanks.length - 1 ? 'bottom pair' : at === 1 ? 'second pair' : 'middle pair'})`
}

/** The player's hand from their own cards and the board: see HandFacts. */
export function describeHand(hole: readonly Card[], board: readonly Card[]): HandFacts {
  if (board.length === 0) {
    const s = startingHand(hole)
    return { made: s.name, startingHandTopPct: s.topPct }
  }
  const all = [...hole, ...board]
  const best = evaluateHand(all)
  const boardPlays = board.length === 5 && evaluateHand(board).value === best.value
  const made = best.category === 'one_pair' ? pairDetail(hole, board) : `${LABEL[best.category]}${boardPlays ? ' (the board plays)' : ''}`
  if (board.length === 5) return { made }

  // Draws: unseen cards that would make a straight or a flush the player's own cards are part of.
  const draws: string[] = []
  let outs = 0
  if (!AT_LEAST_STRAIGHT.has(best.category)) {
    const seen = new Set<Card>(all)
    let flush = false
    const straightRanks = new Set<Rank>()
    for (const card of fullDeck()) {
      if (seen.has(card)) continue
      const next = evaluateHand([...all, card])
      if (!DRAWN.has(next.category)) continue
      const onBoard = [...board, card]
      if (onBoard.length >= 5 && evaluateHand(onBoard).value === next.value) continue
      outs++
      if (next.category !== 'straight') flush = true
      if (next.category !== 'flush') straightRanks.add(rankOf(card))
    }
    if (flush) draws.push('flush draw')
    if (straightRanks.size >= 2) draws.push('open-ended straight draw')
    else if (straightRanks.size === 1) draws.push('gutshot straight draw')
  }
  return { made, draws, outs }
}
