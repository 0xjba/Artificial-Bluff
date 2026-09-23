import { EventStore, runTournamentGame, type GameEvent } from '@ab/core'
import { liveTurboConfig } from '@ab/engine'
import { CallingStation, MockLlm, TagBot, type Player } from '@ab/players'

export const mockPlayers = (): Player[] => [new MockLlm('hex', 'mock/jev'), new TagBot('pill'), new MockLlm('block'), new CallingStation('drip'), new MockLlm('nimbus')]

/** Plays a short free live game into `store` and returns its events. */
export async function playLiveGame(store: EventStore, gameId: string, maxHands = 6, players: Player[] = mockPlayers()): Promise<GameEvent[]> {
  await runTournamentGame({ gameId, players, tournament: { ...liveTurboConfig(gameId), maxHands }, store, decisionTimeoutMs: 1000, budgetUsd: 100 })
  return store.events(gameId)
}
