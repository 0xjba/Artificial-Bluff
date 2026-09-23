import { canonicalJson } from '@ab/core'
import { DEFAULT_MENU_CONFIG, neighbourBlockSize } from '@ab/engine'
import { ACTION_INSTRUCTIONS, JEV_INPUT_PRICE_PER_MTOK, SYSTEM_PROMPT, WIN_INSTRUCTIONS, type PlayerSpec } from '@ab/players'
import type { StudyConfig } from './config'

/**
 * The pre-registration record: everything that can affect results, hashed into the study's game
 * config before hand 1. Budget and concurrency are left out on purpose: they only decide how far a
 * run gets, so topping up the budget and resuming doesn't change the study.
 */
export function preregistration(config: StudyConfig, adaptedLineup: PlayerSpec[], extra: Record<string, unknown> = {}): Record<string, unknown> {
  const record = {
    kind: 'artificialBluff study',
    version: 1,
    study: { ...preregisteredConfig(config), lineup: adaptedLineup },
    seating: { design: 'duplicate, cyclic rotations of a per-group base order', neighbourBlock: neighbourBlockSize(adaptedLineup.length) },
    menu: DEFAULT_MENU_CONFIG,
    prompts: { llmSystem: SYSTEM_PROMPT, jevAction: ACTION_INSTRUCTIONS, jevWin: WIN_INSTRUCTIONS },
    jevMove:
      'the kind of move with the most total weight in the action probabilities (fold; check or call; bet or raise, all sizes), ' +
      "then the most likely option of that kind; ties keep TypeSafe's own choice",
    prices: { jevInputUsdPerMTok: JEV_INPUT_PRICE_PER_MTOK, llm: 'as reported per call by OpenRouter (usage.cost)' },
    outcomes: {
      calibrationHeadline: 'main-pot share: 1 if won alone, 1/k if split k ways, 0 if lost or folded at any point',
      calibrationSecond: 'expected main-pot share at decision time from all hole cards (exact enumeration)',
      perAction:
        'confidence vs 0/1 per action type, never pooled: fold right if all-in equity < toCall / (winnable pot + toCall), ' +
        "call right if >= it; check and raise right if the player's stack did not shrink from the action to the end of the hand",
    },
    contrasts:
      'the first jev seat minus each other seat in bb/100, paired by neighbour block: 95% t CI and two-sided paired t test, ' +
      'Holm correction over those n - 1 comparisons; no other pairwise claims',
    stopping:
      'every checkEvery groups: over the completed prefix of groups in whole neighbour blocks, stop when every ' +
      "player's 95% Student t CI (df = blocks - 1) half-width of bb/100 is at most targetHalfWidthBb100; never " +
      'before minGroups (at least 10 blocks and a check boundary, unless the study has a fixed size); at most maxGroups; every check is ' +
      'logged as a study_checkpoint event; hands cut short by the budget cap are excluded and replayed on resume',
    intervals:
      'per-player 95% t CIs over neighbour blocks are marginal, not simultaneous; pairwise claims use paired ' +
      'contrasts with a Holm correction; percentile bootstrap CIs are reported as a sensitivity check',
  }
  const clash = Object.keys(extra).filter((k) => k in record)
  if (clash.length) throw new Error(`pre-registration: extra key(s) would overwrite the record: ${clash.join(', ')}`)
  return { ...record, ...extra }
}

/** The config fields that are pre-registered (all but budget, concurrency and the unadapted line-up). */
function preregisteredConfig(config: StudyConfig): Record<string, unknown> {
  const { budgetUsd: _budget, concurrency: _concurrency, lineup: _lineup, ...rest } = config
  return rest
}

/** Throws unless `record` is the pre-registration of `config` (same fields and line-up ids). */
export function assertPreregMatches(record: Record<string, unknown>, config: StudyConfig): void {
  const study = record.study as ({ lineup?: Array<{ id?: unknown }> } & Record<string, unknown>) | undefined
  const { lineup = [], ...fields } = study ?? {}
  const same =
    study !== undefined &&
    canonicalJson(fields) === canonicalJson(preregisteredConfig(config)) &&
    canonicalJson(lineup.map((s) => s.id)) === canonicalJson(config.lineup.map((s) => s.id))
  if (!same) throw new Error(`the pre-registration record is not for study config ${config.id}`)
}
