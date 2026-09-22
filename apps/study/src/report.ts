import {
  calibration,
  extractHands,
  playerInfo,
  playerMetrics,
  scoreDecisions,
  type Calibration,
  type HandRecord,
  type PlayerMetrics,
  type ScoredDecision,
  type ShareCache,
} from '@ab/analysis'
import type { EventStore, GameEvent, GameStatus, StudyEndReason } from '@ab/core'
import type { StudyConfig } from './config'
import { pairedContrasts, type Contrast } from './contrasts'
import { assertPreregMatches } from './prereg'
import { completedPrefix, handKeyOf, readProgress, type StudyProgress } from './progress'
import { summarize, type PlayerResult } from './results'

export interface PlayerCalibration {
  playerId: string
  /** What the confidence number means for this player (Jev's and the LLMs' are not the same metric). */
  confidenceSource: string
  /** Stated win probability vs outcome A (main-pot share). The headline chart. */
  winA: Calibration
  /** Stated win probability vs outcome C (expected main-pot share at the decision). */
  winC: Calibration
  /**
   * Confidence vs whether the chosen action was right, per action type. Never pooled: the rules differ
   * by type (equity for folds and calls, later chips for checks and raises) and so do their base rates.
   */
  actionByType: Record<'fold' | 'check' | 'call' | 'raise', Calibration>
}

/**
 * Everything the HTML report shows. In report.json, infinite interval bounds (fewer than 2 blocks)
 * and undefined values (NaN) appear as null.
 */
export interface StudyReport {
  kind: 'artificialBluff study report'
  version: 1
  generatedAt: string
  study: {
    id: string
    configHash: string
    status: GameStatus
    endReason: StudyEndReason | null
    /** Groups the results use (whole neighbour blocks of the completed prefix, or the stopping boundary). */
    analysedGroups: number
    blocks: number
    hands: number
    decisions: number
    /** Everything the study spent, analysed or not (e.g. hands cut off by the budget cap). */
    costUsd: number
    preregistration: unknown
  }
  players: Array<{ playerId: string; kind: string; model: string; answeredModels: string[] }>
  focusId: string
  results: PlayerResult[]
  contrasts: Contrast[]
  metrics: PlayerMetrics[]
  calibration: PlayerCalibration[]
  notes: string[]
}

export interface StudyAnalysis {
  report: StudyReport
  decisions: ScoredDecision[]
}

/** The analysis player: the first Jev seat of the (real, not mock) study config, else the first seat. */
export function focusPlayer(config: StudyConfig): string {
  return (config.lineup.find((s) => s.kind === 'jev') ?? config.lineup[0]!).id
}

/**
 * How many groups the results use: `analysedGroups` once the study has ended; the boundary of a met
 * stopping check that never reached study_ended (a crash, or hands still finishing); otherwise the
 * completed prefix. Always whole neighbour blocks (summarize truncates).
 */
export function analysedGroupCount(progress: StudyProgress, status: GameStatus | null, config: StudyConfig): number {
  if (status === 'ended' && progress.analysedGroups !== null) return progress.analysedGroups
  if (progress.lastCheckpoint?.stop) return progress.lastCheckpoint.groups
  return completedPrefix(progress, config.lineup.length, config.maxGroups)
}

/**
 * The hands the published results use: for every group in the analysed groups (whole blocks), the
 * valid attempt of each rotation. Works on one snapshot of the log, so a report taken while the study
 * runs is consistent.
 */
export function selectStudyHands(events: readonly GameEvent[], status: GameStatus | null, config: StudyConfig): { hands: HandRecord[]; groups: number; progress: StudyProgress } {
  const progress = readProgress(events)
  const n = config.lineup.length
  const groups = summarize(progress, config, analysedGroupCount(progress, status, config)).groups
  const wanted = new Set<string>()
  for (let g = 0; g < groups; g++) for (let r = 0; r < n; r++) wanted.add(progress.validHandIds.get(handKeyOf(g, r))!)
  const hands = extractHands(events).filter((h) => wanted.has(h.handId))
  if (hands.length !== wanted.size) throw new Error(`study ${config.id}: found ${hands.length} of ${wanted.size} analysed hands in the log`)
  return { hands, groups, progress }
}

/** selectStudyHands on the study's current log. */
export function studyHands(store: EventStore, config: StudyConfig): { hands: HandRecord[]; groups: number } {
  const { hands, groups } = selectStudyHands(store.events(config.id), store.game(config.id)?.status ?? null, config)
  return { hands, groups }
}

const CONFIDENCE_SOURCE: Record<string, string> = {
  jev: "derived by Jev from how concentrated its option probabilities are (TypeSafe's definition)",
  llm: 'self-reported by the model ("how sure you are this is the best action")',
  mock: 'a constant from the mock player (not meaningful)',
  bot: 'a constant or rule-based value from the bot (not meaningful)',
}

/** Builds the full report of a study from its event log. `focusId`: whose paired contrasts to report. */
export function analyseStudy(store: EventStore, config: StudyConfig, opts: { focusId: string; generatedAt: string; cache?: ShareCache }): StudyAnalysis {
  const game = store.game(config.id)
  if (!game || game.kind !== 'study') throw new Error(`study ${config.id} has not started`)
  assertPreregMatches(game.config as Record<string, unknown>, config)
  // One read of the log: everything below comes from the same snapshot.
  const events = store.events(config.id)
  const { hands, groups, progress } = selectStudyHands(events, game.status, config)
  const summary = summarize(progress, config, groups)
  const decisions = scoreDecisions(hands, opts.cache ?? new Map())
  const info = playerInfo(events)
  const spent = events.reduce((sum, e) => sum + (e.type === 'decision' ? e.costUsd : 0), 0)

  const calibrationOf = (playerId: string): PlayerCalibration => {
    const mine = decisions.filter((d) => d.playerId === playerId && !d.fallback)
    const win = mine.filter((d) => d.winProbability !== null)
    const conf = mine.filter((d) => d.confidence !== null)
    const actionOf = (type: ScoredDecision['actionType']) =>
      calibration(conf.filter((d) => d.actionType === type).map((d) => ({ p: d.confidence!, o: d.actionGood })))
    return {
      playerId,
      confidenceSource: CONFIDENCE_SOURCE[info.get(playerId)?.kind ?? ''] ?? 'unknown',
      winA: calibration(win.map((d) => ({ p: d.winProbability!, o: d.mainPotShare }))),
      winC: calibration(win.map((d) => ({ p: d.winProbability!, o: d.expectedShare }))),
      actionByType: { fold: actionOf('fold'), check: actionOf('check'), call: actionOf('call'), raise: actionOf('raise') },
    }
  }

  const report: StudyReport = {
    kind: 'artificialBluff study report',
    version: 1,
    generatedAt: opts.generatedAt,
    study: {
      id: config.id,
      configHash: game.configHash,
      status: game.status,
      endReason: progress.lastEnd,
      analysedGroups: groups,
      blocks: summary.blocks,
      hands: hands.length,
      decisions: decisions.length,
      costUsd: spent,
      preregistration: game.config,
    },
    players: config.lineup.map((s) => ({
      playerId: s.id,
      kind: info.get(s.id)?.kind ?? s.kind,
      model: info.get(s.id)?.model ?? '',
      answeredModels: [...new Set(decisions.filter((d) => d.playerId === s.id).map((d) => d.model))].sort(),
    })),
    focusId: opts.focusId,
    results: summary.players,
    contrasts: pairedContrasts(progress, config, groups, opts.focusId),
    metrics: config.lineup.map((s) => playerMetrics(hands, s.id)),
    calibration: config.lineup.map((s) => calibrationOf(s.id)),
    notes: [
      'VPIP and PFR leave out walks (hands with no preflop decision). AF is postflop bets and raises per call (undefined with no calls); WTSD is showdowns per hand seen to the flop.',
      'bb/100: 95% Student t CIs over neighbour blocks of seed groups (df = blocks - 1); the percentile bootstrap CI is a sensitivity check. Per-player CIs are marginal: claims about Jev versus another player rest on the pre-registered paired contrasts (Jev minus each other seat, Holm-corrected over those comparisons); no other pairwise claims are made.',
      'Calibration A (headline): stated win probability vs the share of the main pot actually won (1, 1/k for a k-way split, 0 after any fold). Calibration C: vs the expected main-pot share at the decision from all hole cards (exact enumeration), which removes later actions and board luck.',
      "Per-action calibration, by action type only: confidence vs whether the action was right. Folds and calls are scored by all-in equity (outcome C) against the pot odds of the pot the player could win: a fold is right below them, a call at or above them. This treats the hand as if it went to showdown now and ignores players still to act, a standard approximation. Checks and raises have no such rule: they count as right if the player's stack didn't shrink from that point to the end of the hand, so later streets feed into their score.",
      "Confidence means different things: Jev's is derived from its option probabilities, the LLMs' is self-reported. Compare each player with itself, not the two kinds with each other.",
      "Decisions that fell back to check/fold (timeouts, invalid output, provider errors) are excluded from calibration and counted under fallbacks; only invalid, empty, refused or truncated output counts against the model itself. Latency, tokens and cost per decision include timeouts (at the time limit) but not auto-played decisions (a seat skipped after repeated failures).",
      'Cost: LLMs as reported per call by OpenRouter; Jev as input tokens x the published price (see the pre-registration). "Spent" is everything the study paid for, including hands cut off by the budget cap and hands outside the analysed groups, so it can exceed the per-player totals, which cover analysed hands only.',
    ],
  }
  return { report, decisions }
}
