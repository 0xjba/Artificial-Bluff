# artificialBluff — Status & Tracker

Living document. Update it whenever a task finishes, a decision is made, or a todo appears.
Last updated: 2026-09-21

## Where things are

| What | Where |
|---|---|
| Design spec (approved) | `docs/superpowers/specs/2026-09-21-artificialbluff-design.md` |
| Plan 1: monorepo + engine | `docs/superpowers/plans/2026-09-21-plan-1-engine.md` |
| Plan 2: players, runner, event log | `docs/superpowers/plans/2026-09-21-plan-2-players-runner.md` |
| Plan 3a: study runner | `docs/superpowers/plans/2026-09-21-plan-3a-study-runner.md` |
| Salvage report (old TEN project) | `SALVAGE.md` |
| Salvaged raw code (git-ignored) | `salvage/` (contracts-latest, agents-latest, frontend-latest, pokerkit-harness-old) |
| Jev / TypeSafe API docs | `docs/jev/` |
| Brand previews | `docs/brand/` (mascots-v2-mono.png is current) |
| Verified Plan 1 reference code | built and tested in a scratch copy; the plan contains all of it verbatim |

## Plan series

| # | Plan | Status |
|---|---|---|
| 1 | Monorepo + game engine (`packages/engine`) | ✅ Merged to master (9de0579), 99 tests |
| 2 | Players (Jev, LLM, bots, mock), table runner, SQLite event log | ✅ Merged to master (b94a7be), 181 tests |
| 3 | Study runner (duplicate, budget cap, resume, CI stop) + report/charts | 3a study runner: plan written & verified in scratch (201 tests), executing on `feat/plan-3a-study`; 3b analysis + report: not written |
| 4 | Live server (WebSocket, replays, admin start) + web (Broadcast UI) + mascots (bloub) | Not written yet |

### Plan 1 task progress

- [x] Task 1: Monorepo scaffold (1cf942d; spec ✅ quality ✅)
- [x] Task 2: Cards and seeded shuffling (438e0c8 + fix d549233; spec ✅ quality ✅ — deriveSeed delimiter bug fixed; hand/group seeds = namespace hash + counter)
- [x] Task 3: Hand evaluation (934e67a + fix 2f20d34; spec ✅ quality ✅ — added malformed-card rejection + tie test)
- [x] Task 4: Engine types and side pots (3f9f4e0 + fix 7f02a9a; spec ✅ quality ✅ — buildPots no-live-pot guard + dead-money tests)
- [x] Task 5: Hand state machine (e62c66c + fix 9072572; spec ✅ quality ✅ (opus, 30k-hand fuzz clean) — covered short blinds, TDA cumulative reopen, unknown actions throw, input validation)
- [x] Task 6: Shared action menu (de07b4f + c3aa760 + 936499a; spec ✅ quality ✅ (opus, 265k-decision fuzz clean) — limper/caller-aware sizing, odd-blind rounding, near-duplicate + near-all-in drop)
- [x] Task 7: Live turbo tournament (03c6c65 + fix 0558ae8; spec ✅ quality ✅ — recordHand validates players + chip conservation; 10-player cap)
- [x] Task 8: Duplicate seating (b1c5e72 + fix 316bead; spec ✅ quality ✅ (opus, 400-group probe clean) — neighbour-balanced base orders, input checks, handKey, generic shuffle)
- [x] Task 9: Public exports + random-play invariants (7e61c34; spec ✅; quality folded into final branch review)
- [x] Final branch review (opus): READY TO MERGE (fixes 501660f consumer typecheck, 21e998c wider property + replay tests, 9a470e7 tournament config validation; 99 tests)

### Plan 2 task progress

- [x] Task 1: Seat position names (engine) (8e0b82c; spec ✅ (diff vs reference) quality ✅)
- [x] Task 2: Hand ids config→result (engine) (a107515 + fix 6fa50f1; spec ✅ quality ✅ — strict hand ids, position input validation)
- [x] Task 3: Players package, types, observations (340edce + fix b3e2a49; spec ✅ quality ✅ (opus, 20k-decision leak probe clean) — capped toCall, winnable-pot odds, street-start SPR, no hand id)
- [x] Task 4: Bots and mock LLM (a581394 + fix e94c1d7; spec ✅ quality ✅ — TAG shoves when all-in only raise, AA>KK, mock honours prior abort)
- [x] Task 5: LLM player via OpenRouter (aae9e10 + 46602a4 + 3212f5a; spec ✅ quality ✅ (opus) — truncation, reasoning tokens, no prob rescaling, failure kinds, shared win wording, 200-error = infra)
- [x] Task 6: Jev player (f3cf3f0 + 1e299e5 + b4ec7a9; spec ✅ quality ✅ (opus) — symmetric no-retry, runner timeout governs, validated API answers, sourced price, malformed-response guard)
- [x] Task 7: Player factory and exports (32909dc + d1d6a09; spec ✅ quality ✅ — live-catalog preflight clean for both line-ups)
- [x] Task 8: Core package, events, SQLite store (8284e8b + a35aa52 + tsx dep; spec ✅ quality ✅ fixes (opus): no lost events with concurrent writers, strict canonical JSON, schema migrations, hash in game_started)
- [x] Task 9: Table runner (929c010 + f5c874b + usage-check follow-up; spec ✅ quality ✅ (opus, 3k-hand replay from events clean) — timeout latency = limit, misbehaving-player guards, empty-error auto count, currentBet)
- [x] Task 10: Live tournament driver (0f6bc7b + d62a4c3; spec ✅ quality ✅ — mid-game errors end game as interrupted, validated before writing, meta can't override recorded settings)
- [x] Task 11: pnpm demo / pnpm smoke (74d25e3; spec ✅; quality folded into final review)
- [x] Final branch review (opus): READY TO MERGE (fixes 6dc3f9e: spend checked before every decision, API keys ES-private, onEvent hook; docs cf132bc)

### Plan 3a task progress

- [x] Task 1: Study hands in the core event stream (9226d6e; spec ✅ diff)
- [x] Task 2: Study package and config (6c6ec35; spec ✅ diff)
- [x] Task 3: Bootstrap CIs (f8dfb58; spec ✅ diff). Quality review (opus) → switch to Student t CIs, ≥10-block minimum, checkpoint events, strict config — follow-up fix in progress
- [x] Task 4 (f7c2b56; spec ✅; opus review → follow-up fix in progress): Study runner (progress, results, prereg, run)
- [x] Task 5 (80b8083; spec ✅): pnpm study CLI + example studies (expect engine 104, players 44, core 35, study 35)

## Key decisions (summary; spec is authoritative)

- TypeScript pnpm monorepo; official Jev TS SDK `@typesafe-ai/sdk`.
- Fairness: identical observation for all players, code pre-computes arithmetic, no equity hints (ablation later).
- Study: duplicate format, 100 bb cash hands, bb/100 with bootstrap CIs, CI-based stop, budget cap ~$25, pre-registered config hash.
- Live: on-demand turbo tournament (3,000 chips, blinds up every 8 hands, stop at hand 120), ~$0.50/game, per-game cap, replays when idle.
- Line-up: Jev + 2 frontier + 1 small/fast + 1 open-weight LLM via OpenRouter; all in config.
- Shared action menu of realistic sizes shown as chip amounts.
- Calibration: all players state win probability + confidence; per-action analysis in the report.
- No spectator betting in v1.
- Brand: "artificialBluff", Broadcast direction (felt #0B2A24, brass #E8B04A, Barlow). Mascots: bloub engine (MIT), all neutral white, shapes JEV hexagon / PILL capsule / BLOCK squircle / DRIP droplet / NIMBUS cloud; engine change so narrative states keep each player's shape; rings white.
- Names: character + always-visible model badge (Jev badge shows its version too).

## Open questions / assumptions to confirm

- Hosting: one small container (Fly.io or VPS)? Not chosen.
- Exact OpenRouter model ids: chosen at run time.
- User needs a Jev early-access API key.
- `@ab/engine` exports TS source (no build step). Plan 4 must decide how `apps/server` runs TS in production (`tsx` vs a build with tsup). Flagged by Task 1 review.

## Todos / notes

- Security: public repo `github.com/0xjba/AI-Agents-Poker` has committed `.env` with 6 private keys + OpenRouter/redpill key. User told to rotate/revoke; not yet confirmed done.
- Plan 2: every Decision event must record the chosen chip amount (and pot fraction), because merged menu ids vary by spot; analyse by amount, not id. (Task 6 review)
- Known, deliberate menu behaviours (Task 6 review): caller count can undercount after an incomplete all-in re-raise (rare, still sensible); the SB completing counts as a limper for opening sizes.
- Tune later: simulated live tournaments with simple bots last ~45 hands median (p90 ~80, never hit the 120 cap) vs spec's ~60-80. Re-check with real Jev/LLM players; slow blinds (e.g. every 10 hands) if games are too short. (Task 7 review)
- Plan 2 runner: thread a hand id from nextHandConfig through HandResult so recordHand can reject a replayed result from a different hand (Task 7 review residual).
- Plan 3: bootstrap by whole neighbour blocks; compute block size with neighbourBlockSize(players.length), never hardcode 4. (Task 8 review)
- Plan 2 (final review recs): add engine helpers `positions(state)` (BTN/SB/BB/UTG/CO, heads-up aware) and observation arithmetic (to call, pot odds, eff. stack bb, SPR, timeout default check-else-fold); runner must derive street/board events by diffing (one action can deal flop+turn+river in a run-out; a hand can complete inside createHand); thread hand id.
- Plan 2 tests: add a test that restores a JSON round-tripped state from the event log and continues the hand with applyAction; property test could include sub-1bb stacks. (final review minor)
- Plan 4 (Task 8 review): GameRow.config holds master seeds — never send a running game's config to spectators; add a redaction helper.
- Delete any local data/*.db created before the schema-migration fix (user_version 0 + tables → migration fails). (Task 8 re-review)
- Plan 3: add decisions(model) index if analysis groups by model alone. (Task 8 re-review)
- Plan 3 (Task 8 review): add seed/rotation/order ids to study events for resume; consider (player_id, model) analysis views.
- Plan 4: stopping a live game (abort) takes effect between hands, so a stop can wait up to one hand. (Task 10 review)
- Plan 3 (Plan 2 final review): resume primitive for a partially played hand (abandon/delete or per-attempt hand id; the probe saw duplicate hand_started after crash+replay); a study-shaped end event (EndReason has no ci_stop/completed); default handId = handKey(hand) in cashHandConfig; count timed-out calls at a conservative cost estimate (catalog pricing × max_tokens) for caps; optionally compare OpenRouter GET /api/v1/key usage before/after runs.
- Plan 4 (Plan 2 final review): use runTournamentGame's onEvent hook for the live feed; call store.interruptRunningGames() on server start; redact seeds from configs; handle Ctrl-C/SIGTERM by aborting the game.
- Smoke nits (Plan 2 final review): `--budget=0.5` syntax is ignored (use `--budget 0.5`); no Ctrl-C handling; preflight doesn't validate the Jev model id or keys (a bad key just fails every call as infra, costing nothing).
- Plan 4 (final review): NEVER send `deck` or `config.seed` in live snapshots (reveals future cards; tournament seeds are base+handNumber so one seed reveals all later decks) — publish seeds only after the game. HandResult lacks best-five cards for winner highlighting: compute in Plan 4 or add to engine.
- Line-ups (user decision 2026-09-21): research line-up (Fable 5.1, GPT-6 Astra, Gemini 3.8 Flash, Llama 4 Maverick; ~$1.60-1.80/live game at the measured ~700-token prompt) for study + recorded games; live line-up (Sonnet 5, GPT-5.6 Sol, Gemini 3.8 Flash, Llama 4 Maverick; ~$0.40/game) for everyday live games. Files: lineups/{research,live}.example.json. Real smoke test only with user go-ahead + keys.
- Equity-hint ablation (`hints.equity`) not implemented in Plan 2; do it in Plan 3 with the ablation runs.
- Deferred from Plan 2 Task 3 review: list seats in action order / add playersToActAfter; compact LLM message (~180 vs ~350 tokens, same info) to cut input cost ~25% before the study is frozen.
- DECIDED (2026-09-21): calibration outcome A = main-pot share (1, 1/k split, 0 lose/fold) headline; C = expected main-pot share at decision time (exact enumeration with all hole cards) second chart. Report Jev confidence and LLM confidence separately.
- Later: record OpenRouter `provider` per decision (same slug can be served by different providers/quantisations). (Task 5 review minor)
- Ablation idea (Task 6 review): decomposed Jev (atomic questions combined in code, TypeSafe's recommended pattern) vs single-Choice Jev. Pre-register before running.
- Jev docs advice: atomic "gut-check" questions; no arithmetic; filter state; pin model version.
- bloub is "an SVG recreation of the x.ai bot avatar": keep our variant clearly distinct (no black body, no circle, no rainbow rings).
- Scratch bloub preview (custom colours, Mascots.vue) lived in the session scratchpad; recreate in Plan 4.

## Execution log

- 2026-09-21: Plan 3a Task 1-3 stats follow-up committed (f0b5424, byte-identical to reference). Task 4 committed (f7c2b56, spec ✅). Opus review of Task 4: approve with fixes → deterministic check schedule (every boundary in order; resume from last checkpoint; results pinned to the stop boundary via study_ended.analysedGroups), ci_target wins over budget_cap, claimGame + --takeover (no double runs), prereg must match config, budget overshoot documented, dead format check removed, 7 new tests. Prototyped in reference: engine 104, players 44, core 35, study 35. Follow-up fix to be applied on branch next, then Task 5.
- 2026-09-21: Task 5 committed (80b8083, identical to reference). Opus re-review of Task 4 fixes: approve with fixes → read progress after claimGame; early return uses study_ended.analysedGroups; minGroups multiple of checkEvery. Not done (by design): checking Player kind/model against the pre-registered seat (tests deliberately use bots in mock seats; the CLI builds players from the same line-up). Reference: core 35, study 35.
- TODO (minor, from review): budget-cap-then-ci_target test; stronger concurency-skip test (checkEvery 4, ~200 groups).
- TODO (minor, from review): record code version (git SHA) with a study without breaking resume (e.g. in game_started, not the prereg hash); explain in the report that in-flight hands after a CI stop are logged but not analysed.

- 2026-09-21: Decision (from stats review of Plan 3a): stopping rule and published CIs use Student t over neighbour blocks (bootstrap only as sensitivity check); CI rule never fires before 10 blocks (40 groups) unless fixed-size; every check logged; pairwise claims need paired contrasts + Holm (Plan 3b). Flag to user.

- 2026-09-21: Plan 2 built on feat/plan-2-players — 11 tasks, each spec (diff vs verified reference) + quality reviewed (opus for the fairness-critical ones). Reviews caught: short-stack toCall/pot-odds and drifting SPR, bot folding aces, AA=KK, LLM truncation/reasoning-token/percentage-rescaling/win-wording issues, Jev asymmetric retries + unsourced price, SQLITE_BUSY lost events with concurrent writers, non-canonical config hashes, runner crash paths and latency skew, stuck 'running' games, soft budget cap, API keys visible on player objects.

- 2026-09-21: Plan 1 complete on feat/plan-1-engine — 9 tasks, each spec+quality reviewed; reviews caught deriveSeed collision, malformed-card evaluation, pot crash, 3 NLHE rules bugs, menu sizing bias, unvalidated tournament results, duplicate-seating neighbour bias, consumer typecheck. 99 tests.

- 2026-09-21: Decision: duplicate groups vary base seating (multiplier k = 1 + g mod 4 for 5 players) so neighbours balance over 4-group blocks; study stop checks in multiples of 4. Spec §4/§6 updated. Flag to user.

- 2026-09-21: Decision: adopt TDA Rule 43 (several short all-ins adding to a full raise reopen betting). Recorded in spec §4.

- 2026-09-21: Salvage done; design approved; Plan 1 written, verified in scratch (64 tests pass); execution started with subagent-driven development.
