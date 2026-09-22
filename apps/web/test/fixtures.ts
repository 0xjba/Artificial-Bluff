import { EventStore, runTournamentGame, type GameEvent } from '@ab/core'
import { liveTurboConfig } from '@ab/engine'
import { CallingStation, MockLlm, TagBot } from '@ab/players'

/** Events of a short free mock live game (a jev seat that is really a mock, and bots). */
export async function mockGame(maxHands = 4, seed = 'web'): Promise<GameEvent[]> {
  const store = new EventStore()
  const players = [new MockLlm('jev', 'mock/jev'), new TagBot('pill'), new MockLlm('block'), new CallingStation('drip'), new MockLlm('nimbus')]
  await runTournamentGame({ gameId: 'g', players, tournament: { ...liveTurboConfig(seed), maxHands }, store, decisionTimeoutMs: 1000, budgetUsd: 10 })
  return store.events('g')
}
