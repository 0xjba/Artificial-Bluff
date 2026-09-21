# artificialBluff — Status & Tracker

Living document. Update it whenever a task finishes, a decision is made, or a todo appears.
Last updated: 2026-09-21

## Where things are

| What | Where |
|---|---|
| Design spec (approved) | `docs/superpowers/specs/2026-09-21-artificialbluff-design.md` |
| Plan 1: monorepo + engine | `docs/superpowers/plans/2026-09-21-plan-1-engine.md` |
| Salvage report (old TEN project) | `SALVAGE.md` |
| Salvaged raw code (git-ignored) | `salvage/` (contracts-latest, agents-latest, frontend-latest, pokerkit-harness-old) |
| Jev / TypeSafe API docs | `docs/jev/` |
| Brand previews | `docs/brand/` (mascots-v2-mono.png is current) |
| Verified Plan 1 reference code | built and tested in a scratch copy; the plan contains all of it verbatim |

## Plan series

| # | Plan | Status |
|---|---|---|
| 1 | Monorepo + game engine (`packages/engine`) | Executing on branch `feat/plan-1-engine` (subagent-driven: implementer + spec review + quality review per task) |
| 2 | Players (Jev, LLM, bots, mock), table runner, SQLite event log | Not written yet: write after Plan 1 is built |
| 3 | Study runner (duplicate, budget cap, resume, CI stop) + report/charts | Not written yet |
| 4 | Live server (WebSocket, replays, admin start) + web (Broadcast UI) + mascots (bloub) | Not written yet |

### Plan 1 task progress

- [x] Task 1: Monorepo scaffold (1cf942d; spec ✅ quality ✅)
- [ ] Task 2: Cards and seeded shuffling
- [x] Task 3: Hand evaluation (934e67a + fix 2f20d34; spec ✅ quality ✅ — added malformed-card rejection + tie test)
- [x] Task 4: Engine types and side pots (3f9f4e0 + fix 7f02a9a; spec ✅ quality ✅ — buildPots no-live-pot guard + dead-money tests)
- [x] Task 5: Hand state machine (e62c66c + fix 9072572; spec ✅ quality ✅ (opus, 30k-hand fuzz clean) — covered short blinds, TDA cumulative reopen, unknown actions throw, input validation)
- [x] Task 6: Shared action menu (de07b4f + c3aa760 + 936499a; spec ✅ quality ✅ (opus, 265k-decision fuzz clean) — limper/caller-aware sizing, odd-blind rounding, near-duplicate + near-all-in drop)
- [x] Task 7: Live turbo tournament (03c6c65 + fix 0558ae8; spec ✅ quality ✅ — recordHand validates players + chip conservation; 10-player cap)
- [ ] Task 8: Duplicate seating
- [ ] Task 9: Public exports + random-play invariants (expect 86 tests, 8 files)

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
- Jev docs advice: atomic "gut-check" questions; no arithmetic; filter state; pin model version.
- bloub is "an SVG recreation of the x.ai bot avatar": keep our variant clearly distinct (no black body, no circle, no rainbow rings).
- Scratch bloub preview (custom colours, Mascots.vue) lived in the session scratchpad; recreate in Plan 4.

## Execution log

- 2026-09-21: Decision: adopt TDA Rule 43 (several short all-ins adding to a full raise reopen betting). Recorded in spec §4.

- 2026-09-21: Salvage done; design approved; Plan 1 written, verified in scratch (64 tests pass); execution started with subagent-driven development.
