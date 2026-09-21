import { DEFAULT_MENU_CONFIG, neighbourBlockSize } from '@ab/engine'
import { ACTION_INSTRUCTIONS, JEV_INPUT_PRICE_PER_MTOK, SYSTEM_PROMPT, WIN_INSTRUCTIONS, type PlayerSpec } from '@ab/players'
import type { StudyConfig } from './config'

/**
 * The pre-registration record: everything that can affect results, hashed into the study's game
 * config before hand 1. Budget and concurrency are left out on purpose: they only decide how far a
 * run gets, so topping up the budget and resuming doesn't change the study.
 */
export function preregistration(config: StudyConfig, adaptedLineup: PlayerSpec[], extra: Record<string, unknown> = {}): Record<string, unknown> {
  const { budgetUsd: _budget, concurrency: _concurrency, lineup: _lineup, ...rest } = config
  return {
    kind: 'artificialBluff study',
    version: 1,
    study: { ...rest, lineup: adaptedLineup },
    seating: { design: 'duplicate, cyclic rotations of a per-group base order', neighbourBlock: neighbourBlockSize(adaptedLineup.length) },
    menu: DEFAULT_MENU_CONFIG,
    prompts: { llmSystem: SYSTEM_PROMPT, jevAction: ACTION_INSTRUCTIONS, jevWin: WIN_INSTRUCTIONS },
    prices: { jevInputUsdPerMTok: JEV_INPUT_PRICE_PER_MTOK, llm: 'as reported per call by OpenRouter (usage.cost)' },
    outcomes: {
      calibrationHeadline: 'main-pot share: 1 if won alone, 1/k if split k ways, 0 if lost or folded at any point',
      calibrationSecond: 'expected main-pot share at decision time from all hole cards (exact enumeration)',
    },
    stopping:
      'every checkEvery groups: over the completed prefix of groups in whole neighbour blocks, stop when every ' +
      "player's 95% Student t CI (df = blocks - 1) half-width of bb/100 is at most targetHalfWidthBb100; never " +
      'before minGroups (at least 10 blocks unless the study has a fixed size); at most maxGroups; every check is ' +
      'logged as a study_checkpoint event; hands cut short by the budget cap are excluded and replayed on resume',
    intervals:
      'per-player 95% t CIs over neighbour blocks are marginal, not simultaneous; pairwise claims use paired ' +
      'contrasts with a Holm correction; percentile bootstrap CIs are reported as a sensitivity check',
    ...extra,
  }
}
