import { canonicalJson } from '@ab/core'
import { DEFAULT_MENU_CONFIG, neighbourBlockSize } from '@ab/engine'
import { ACTION_INSTRUCTIONS, JEV_INPUT_PRICE_PER_MTOK, JEV_MODE_RULES, KIND_INSTRUCTIONS, SIZE_INSTRUCTIONS, systemPrompt, WIN_INSTRUCTIONS, type PlayerSpec } from '@ab/players'
import type { StudyConfig } from './config'

/**
 * The pre-registration record: everything that can affect results, hashed into the study's game
 * config before hand 1. Budget and concurrency are left out on purpose: they only decide how far a
 * run gets, so topping up the budget and resuming doesn't change the study.
 */
export function preregistration(config: StudyConfig, adaptedLineup: PlayerSpec[], extra: Record<string, unknown> = {}): Record<string, unknown> {
  // Jev seats with a mode carry its questions and rule; earlier records (no modes) are unchanged, and
  // the main study's rule (jevMove) is recorded unless every Jev seat declares a mode of its own.
  const jevs = adaptedLineup.filter((s): s is Extract<PlayerSpec, { kind: 'jev' }> => s.kind === 'jev')
  const modes = [...new Set(jevs.flatMap((s) => (s.mode ? [s.mode] : [])))].sort()
  const twoStep = modes.includes('two-step')
  const ruleInUse = jevs.length === 0 || jevs.some((s) => !s.mode)
  const record = {
    kind: 'artificialBluff study',
    version: 1,
    study: { ...preregisteredConfig(config), lineup: adaptedLineup },
    seating: { design: 'duplicate, cyclic rotations of a per-group base order', neighbourBlock: neighbourBlockSize(adaptedLineup.length) },
    menu: DEFAULT_MENU_CONFIG,
    prompts: {
      llmSystem: systemPrompt(config.handFacts ?? false),
      jevAction: ACTION_INSTRUCTIONS,
      jevWin: WIN_INSTRUCTIONS,
      ...(twoStep ? { jevKind: KIND_INSTRUCTIONS, jevSize: SIZE_INSTRUCTIONS } : {}),
    },
    ...(modes.length ? { jevModes: Object.fromEntries(modes.map((m) => [m, JEV_MODE_RULES[m]])) } : {}),
    ...(ruleInUse ? { jevMove:
      'the kind of move with the most total weight in the action probabilities (fold; check or call; bet or raise, all sizes), ' +
      "then the most likely option of that kind; ties keep TypeSafe's own choice" } : {}),
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
  // Named primary outcomes: stated in the record before the first hand, so the paper can't choose later.
  if (config.primary === 'matched-spots') {
    Object.assign(record, {
      primaryOutcomes:
        'on matched spots (decisions identical across the duplicate rotations of a group: the same cards in the same seat and the same actions so far), ' +
        'the first jev seat minus each other seat on (1) |stated win chance − true chance| in points and (2) at spots facing a bet, continue-or-fold ' +
        'accuracy against the pot odds (continue = call or raise, right at or above the odds; fold right below them); per-block mean of the ' +
        'differences over the spots both faced, two-sided paired t test over neighbour blocks, Holm correction within each measure',
      secondaryOutcomes:
        'Brier score and skill (against a fair-share forecast, 1 / players still in) versus the main-pot share won, and ECE versus the true chance, ' +
        'each with a 95% bootstrap interval over neighbour blocks, and the paired Brier comparison; fold and call accuracy; time and cost per ' +
        'decision; chips (bb/100) with the paired contrasts above; play style. Secondary results are reported, not used for the headline claim',
    })
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
