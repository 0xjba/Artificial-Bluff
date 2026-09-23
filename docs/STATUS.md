# artificialBluff — Status & Tracker

Living document. Update it whenever a task finishes, a decision is made, or a todo appears.
Last updated: 2026-09-23

## Where things are

| What | Where |
|---|---|
| GitHub remote (`origin`) | https://github.com/0xjba/Artificial-Bluff (master + feat/plan-3a-study pushed 2026-09-22) |
| Design spec (approved) | `docs/superpowers/specs/2026-09-21-artificialbluff-design.md` |
| Plan 1: monorepo + engine | `docs/superpowers/plans/2026-09-21-plan-1-engine.md` |
| Plan 2: players, runner, event log | `docs/superpowers/plans/2026-09-21-plan-2-players-runner.md` |
| Plan 3a: study runner | `docs/superpowers/plans/2026-09-21-plan-3a-study-runner.md` |
| Plan 3b: analysis and report | `docs/superpowers/plans/2026-09-22-plan-3b-analysis-report.md` |
| Plan 4a: live server | `docs/superpowers/plans/2026-09-22-plan-4a-live-server.md` |
| Plan 4b: mascots | `docs/superpowers/plans/2026-09-22-plan-4b-mascots.md` |
| Plan 4c: web UI | `docs/superpowers/plans/2026-09-22-plan-4c-web.md` |
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
| 3 | Study runner (duplicate, budget cap, resume, CI stop) + report/charts | 3a study runner: ✅ merged (04bc98f), 220 tests; 3b analysis + report: ✅ merged (0d46196), 258 tests |
| 4 | 4a live server (SSE feed, replays, admin start/stop); 4b mascots (bloub engine, shapes, React component); 4c web (Broadcast UI) | 4a: ✅ merged, 306 tests; 4b: ✅ merged, 397 tests; 4c: ✅ merged, 412 tests |
| 5 | Run your own table (/play: BYO keys, game in the browser, TypeSafe relay) | ✅ merged (42e2eb7), 452 tests |
| 6 | UI revamp from the design pack (Live, Replays, Models, Run a table, Research) | Done on `feat/ui-revamp`, review fixes in, 466 tests; awaiting merge |

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
- [x] Task 3: CIs (f8dfb58 + fix f0b5424; spec ✅; opus review → Student t CIs, ≥10-block minimum, checkpoint events, strict config)
- [x] Task 4: Study runner (f7c2b56 + fixes 5df0df9, 76ca712; spec ✅; opus review + re-review → data-only check schedule, claimGame, analysedGroups)
- [x] Task 5: pnpm study CLI + example studies (80b8083; spec ✅)
- [x] Final branch review (opus): merge after fixes → fixed in eae9624 + a02dff0 (explicit --live, strict args, Ctrl-C in mock runs, stored line-up on resume, status uses analysedGroups, exit codes, docs); re-review: **ready to merge** (engine 104, players 44, core 35, study 37)

### Plan 3b task progress

- [x] Task 1: Exact main-pot equity in the engine (2cda785; spec ✅)
- [x] Task 2: Analysis package and hand records, outcome A (0c8fd2e; spec ✅)
- [x] Task 3: Outcome C and per-action score (e34cf53; spec ✅)
- [x] Task 4: Calibration and player metrics (b8fa9bb; spec ✅). Opus review of Tasks 1-4: approve with fixes → auto decisions out of latency/cost, calls scored by equity, per-action calibration per type only, winnable-pot odds, group by game, VPIP without walks, model-only fallback rate, 7 tests (fixed in b7f39c3)
- [x] Task 5: Valid hand ids + paired contrasts with Holm (5a083ad; spec ✅)
- [x] Task 6: Report model + CSV export (a80ed5a + b7f39c3; spec ✅)
- [x] Task 7: HTML report (d122fac; spec ✅)
- [x] Task 8: pnpm study report (9e2c24d; spec ✅; 256 tests)
- [x] Final branch review (opus): merge after fixes → fixed in acd70d1 + 85e0454; re-review: **ready to merge** (258 tests)

### Plan 4a task progress

- [x] Task 1: Seeded equity estimate in the engine (6b29863; spec ✅)
- [x] Task 2: Table view reducer in core (faca4e0; spec ✅)
- [x] Task 3: Server package, config, public views (72fb48a; spec ✅)
- [x] Task 4: Hub + true-equity annotations (96142e9; spec ✅). Opus review of Tasks 1-4: approve with fixes → reducer clears equity at hand end (client == hub, tested), isOver (interrupted study keeps its seed secret), reels regroup interleaved study hands, strict MOCK/number/origin config, game_ended closes open hand, hand seatOrder, subscriber-copy broadcast, shared engine validator (fixed in b5ffb3e)
- [x] Task 5: Replays and highlights (37fb80b; spec ✅)
- [x] Task 6: Live controller + director (4627e06; spec ✅)
- [x] Task 7: Live line-up (aaba4d3; spec ✅)
- [x] Task 8: HTTP API, app, pnpm live (4e40cea; spec ✅; 298 tests; free mock server checked end to end)
- [x] Final branch review (opus): merge after fixes → malformed URL 400 (was a crash), Ctrl-C double signal, SSE back-pressure (1 MB), single-server db lock + interrupt only live games, director survives errors, paged events, replay cache, stopped live games replayed, REPLAY_PACE_MS ≥ 10, catalog timeout, idle() no spin (fixed in 1a551fe; server 42, total 306; free mock server SIGINT checked end to end — exit 0, game row interrupted with final game_ended event, lock file released)

### Plan 4b task progress

- [x] Task 1: Vendor bloub engine (d33be1a; controller; pristine = upstream b4bb3c1)
- [x] Task 2: White rings + shape kept through animations (ea3b110; spec ✅; upstream orbit-margin comment dropped as now wrong)
- [x] Task 3: Cast + cues (7d33d51; spec ✅)
- [x] Task 4: Driver (0fc326f; spec ✅)
- [x] Task 5: React component (358a4c2; spec ✅)
- [x] Task 6: Preview sheet (0f558c6; spec ✅; 391 tests)
- [x] Final branch review (opus): merge after fixes → fixed in b4b72dd; re-review: **ready to merge** (397 tests)

### Plan 4c task progress

- [x] Task 1: Browser-safe @ab/core/view + latency total (b8005dc; spec ✅)
- [x] Task 2: Web scaffold + pure logic (8aa85b1; spec ✅)
- [x] Task 3: Broadcast screen components (34befb8; spec ✅)
- [x] Task 4: Pages, styles, replays, research, about (645ac91; spec ✅; build clean; browser walkthrough on the repo build ✅)
- [x] Final branch review (opus): merge after fixes → fixed in 7a71bea + b7fddfe; re-review: **ready to merge** (412 tests; build clean)

## Key decisions (summary; spec is authoritative)

- TypeScript pnpm monorepo; official Jev TS SDK `@typesafe-ai/sdk`.
- Fairness: identical observation for all players, code pre-computes arithmetic, no equity hints (ablation later).
- Study: duplicate format, 100 bb cash hands, bb/100 with Student t CIs over neighbour blocks (bootstrap sensitivity), CI-based stop, budget cap ~$25, pre-registered config hash.
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
- Plan 3 (done): CIs over whole neighbour blocks; compute block size with neighbourBlockSize(players.length), never hardcode 4. (Task 8 review)
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
- Scratch bloub preview (custom colours, Mascots.vue) lived in the session scratchpad; replaced by Plan 4b's `pnpm --filter @ab/mascot preview` → docs/brand/mascots.html.

## Execution log

- 2026-09-22: UI polish on branch `feat/ui-polish` (e7f8704, 422 tests): SVG card faces (corner indices, pips, court frames), plain-English action log grouped by hand (filled from game start on join), live time shift (seek bar + hand steps, past plays on until caught up, dimmed LIVE button jumps back; `/api/games/:id/events` now serves running games with seeds masked), no duplicate LIVE title, seat bar reads "Win 36%". In review. Next: merge, then VPS deploy files (Docker/compose/Caddy/guide); smoke test waits for the user's keys in `.env`. Possible follow-up: same seek bar on /replays pages.
- 2026-09-22: UI polish merged + pushed (1ebb9f2, 423 tests). Deployment on `feat/deploy`: Dockerfile (one image, tsx server + built Next), docker-compose (server on 127.0.0.1:8787 only, web, Caddy HTTPS with no compression so SSE streams), `docs/deploy.md` (VPS setup, admin start/stop + cron, reports via rsync, updates, backups, troubleshooting). Tested locally with mock players: HTTPS + HTTP redirect, admin API not public (404), SSE streams at game pace through Caddy+Next, running-game history for seeking, graceful stop (hand finishes, game interrupted), hard kill recovers (stale lock cleared), backup command, image holds no .env/data/.git. Next: user deploys to their VPS; smoke test waits for keys.
- 2026-09-22: deploy merged + pushed (ad4968a). "Run your own table" (BYO keys, game runs in the visitor's browser) feasibility done: see `docs/byo-table-feasibility.md`. OpenRouter browser calls + OAuth PKCE sign-in work; TypeSafe blocks browser CORS (Jev seats need TypeSafe to enable CORS, or a pass-through relay); game code bundles for the browser (86 KB gz, 40-hand mock game in 28 ms); 267 supportable OpenRouter models. User decisions: no sponsored Jev seats, any seat's model is selectable, no shared replays, no community page. Waiting on the user's call about Jev seats before planning.
- 2026-09-23: the gold hexagon seat is HEX, not JEV (user's decision). The characters are the house, so any model can sit in any seat; the player *kind* `jev` (the TypeSafe adapter) keeps its name, and so does the model, the `jev-vs-llm` hand tag and the report copy about what Jev returns. Seat ids renamed in `packages/mascot/src/cast.ts`, `lineups/*.json` (including the local live.json), `apps/web/lib/byo/table.ts` (SEAT_IDS), fixtures and tests; `characterFor` keeps a `FORMER_IDS` map so games, replays and studies already in the database still show HEX. The `pebble` fallback id is gone — seat 0 no longer changes identity when a non-Jev model plays it, which was the reason for the rename. Copy reworded: "the Jev model can only play seat 1", "add a TypeSafe key for the seat playing Jev".

- 2026-09-23: the narrow table is now the same table. It had `border-radius: 50%` (an ellipse) at 340/600, where the desktop felt is 404/610 with a radius of half its width — a capsule with straight sides. Both restatements now use 404/610 and a px radius, so the shape holds at 375 (367x554), 760 (420x634) and 1440 (404x610), all ratio 0.66; seat places re-spaced to suit (`PHONE_PLACES` tops 12/71/99). `test/styles.test.ts` now checks every `.felt` rule declares the same ratio and never a percentage radius.

- 2026-09-23: second pass on the narrow layout. The seats now have their own places for a stacked screen (`PHONE_PLACES`/`phonePlace` in Stage.tsx, passed as `--pl`/`--pt`): out on the rim at 0% and 100%, with the pill anchored by a shift that follows the place, so the width either side of the table is used instead of the seats huddling toward the middle. The table takes the column's width (`min(420px, 100%)`, the desktop oval's proportions) rather than a fixed 330 egg, and the stage keeps 58px under it for the seat that hangs off the rim. These rules moved from ≤680 to the whole stacked range (≤860), where the same overlap was still happening — measured at 375 and 760: no pair of pills intersects, none clashes with the pot or board, none spills past the stage. A seat's win line reads "–" rather than "Folded" on the felt (the bar under it already says so, and the word broke the line in two, making that pill taller). Also: the menu button is pinned right so it keeps its place on pages with no programme; the seek bar's Pause is an icon; and the menu drop-down on the paper pages is cream with ink links, not a dark slab with gold text.

- 2026-09-23: phone pass over the whole site, plus four fixes the user raised. The design pack has no phone artboard and no media query anywhere, so the mobile layout is ours: the five nav links fold into a menu that drops out of the header (`SiteNav`), the explainer is one line, the seats shrink and sit further down a taller felt so they stop overlapping (measured: no pair intersects), the hand log is a 340px box like the desktop column (the home page went 3,829px tall to 1,622), the Models board becomes one card per seat with its figures labelled from `data-k`, and Replays/Run a table/Research get their own phone type and gutters. Also: the win-chance track was nearly invisible unfilled (#08201b on #121b18) and is now #223129; the ≈ of an estimate is its own lighter mark (`WinChance`, `.approx`) instead of a heavy glyph riding above the digits; the decision panel's reserved height is gone (it read as dead space with a one-line quote). The Research page stays the design's paper page but wears the site's furniture: mascots and model chips per seat (`SeatStrip`, real figures), gold rules over the metric figures, and the design's 'Watch the live table' link in the header. `test/styles.test.ts` gained a guard for module classes used but never defined — it caught five (`.replays`, `.kicker`, `.replays-section`, `.hint`, `.signin`), which is why a page heading and a kicker had been rendering unstyled since the move to CSS modules.

- 2026-09-24: first real smoke attempt (smoke-2026-09, $0.0040) stopped after 8 hands: Claude Fable 5.1, GPT-6 Astra and Gemini 3.8 Flash rejected every call with "Reasoning is mandatory for this endpoint and cannot be disabled" (our default sends effort 'none'); only Jev and Llama answered. Probed (~$0.0024): all three accept effort 'minimal' and 'low'; Claude Sonnet 5 and GPT-5.6 Sol accept 'none'. Added reasoning mode 'minimal' ({effort:'minimal', exclude:true}, 1500-token allowance) and set it for those three seats in the study configs and research line-up, and for Gemini in the live line-ups (live games would have failed the same way). The smoke re-runs as smoke-2026-09b (a changed config can't resume the old id: the pre-registration guard). First real figures per decision: Jev 2.0 s/$0.00004, Llama 1.6 s/$0.00014, Gemini 3.3 s/$0.0008, GPT-6 Astra 4.4 s/$0.012, Claude Fable 5.1 5.7 s/$0.016 — about $0.035 a hand, so $25 buys roughly 700 hands. One Gemini 429 (upstream rate limit) seen: counted as infra, not the model's judgement.

- 2026-09-24: Research page rebuilt in the shape of the user's reference (bennyfit.vercel.app/research): the intro (as written), "What the measurements say" (a headline written by `headline()`, a paragraph naming the comparison, eight measured tiles from `researchTiles()` — speed, cost, points off the true odds, lean, fold/call accuracy, fallbacks, chips with intervals or a Holm-significant result, decisions scored — three findings, and a caveat from `researchCaveat()`), and the technical report: the study's paper.pdf in a pdf.js viewer (`PaperViewer`: two-page spreads on wide screens, one page on phones, Download PDF), plus links to the decision CSV and report JSON. The page and the PDF share `paperFacts()` (`@ab/study/paper`), so they can't disagree. It shows only studies real models played: a rehearsal (mock players) is never presented as results; with none, it says the first study is being run and names what will be measured. `?preview=rehearsal` shows the layout on a rehearsal in development only, under a red banner. Removed: the live-game figures, seat strip and the old HTML page reader. Verified in production build: the PDF worker is served. Blocked on the user: API keys in .env (they were empty), then the approved smoke study (frontier line-up, $1.50 cap), then the go-ahead for the $25 main study.
- 2026-09-24: smoke study smoke-2026-09b ran (user-approved, $1.5220, ended budget_cap after 20 hands / 204 decisions; report + paper.pdf in reports/smoke-2026-09b). Per decision p50: Jev 526 ms / $0.00004, Llama 1.18 s / $0.00015, Gemini 2.07 s / $0.0008 (one 429), GPT-6 Astra 3.37 s / $0.0105, Fable 5.1 5.11 s / $0.0159; about $0.056 a hand, so $25 buys roughly 450 hands. Found a bug in our Jev integration, not in Jev: we played TypeSafe's single most likely option, but raising comes in several sizes and calling is one option, so 52% on raising lost to 42% on calling and Jev never raised after the flop (AF 0.00, VPIP 65%, WTSD 90%, -481 bb/100 over 20 hands). Fix (`chooseMove`, packages/players/src/jev/jev-player.ts): the kind of move with the most total weight (fold; check/call; bet/raise), then its most likely size; ties keep TypeSafe's choice. Pre-registered as `jevMove` (so the config hash changes) and stated in the paper's method only for studies that used it. Applies to live games too. Smoke id bumped to smoke-2026-09c. Research page: `studyKind()` tells study / pilot (ids `smoke-`, `pilot-`) / rehearsal; only a study is shown as results, `?preview=pilot|rehearsal` in development only. Observed, not yet explained on the page: Jev was further off the true odds (21.8 pts vs 17.2-20.5) but best calibrated (ECE 0.038), likely because it played more marginal spots. Waiting on: the user's go-ahead for the $25 main study (optionally a second ~$1.50 smoke first to see the fix on real calls).
- 2026-09-24: the study report now writes the paper: `paper.html` and, with Chrome, `paper.pdf` (`apps/study/src/paper.ts`, `pdf.ts`). Two-column technical report built from the study's numbers; claims only when they hold (ratios ≥1.5×, closer than every model, chips only if Holm-significant); five figures, six tables, appendices with the exact prompts and the pre-registration record; a rehearsal is marked in every page margin. Study configs' first seat renamed jev → hex (nothing pre-registered had run).

- 2026-09-23: "Show all hands" / "Show fewer" push the page down from the log's top instead of seeming to grow upward. Two causes: scroll anchoring held the button/footer still, and — the bigger one — the page's mandatory section snapping re-snapped to a section edge the moment the log changed height (it jumped to the decision card). `HandLog` now records the log's top before toggling, corrects the scroll by exactly how far it moved (closing from far down brings the top back under the header), and pauses the page's snapping (`pauseSnapping`) until the reader's next scroll settles. Measured on a paused replay: the log's top stays at 114.1px through open and close, immediately and after settling; snapping resumes after the next scroll.

- 2026-09-23: the phone hand log is a box of one fixed height (`.log-body`, `min(46svh, 400px)`, overflow hidden, older rows faded out under a mask) instead of a count cap, which still let the section grow and shrink with the rows. Not a scrolling box (fought the snapping) and not screen-high (left a void). The "Show all N hands" button is always rendered and only made visible when the box is actually clipping (measured in a layout effect, not guessed from counts), so it never shifts anything when it appears. Measured: the log section is 478px from 4 rows at a game's start to 52 rows, 168 samples across two games.

- 2026-09-23: phone hand log fixes (from the user's phone screenshot). The log no longer has a screen-high `min-height` (it left a void under a short log that changed size with every hand; now 44px of padding). "Older hands" no longer navigates to the game's replay — that page showed the same capped log with the same button linking to itself — it is a toggle, "Show all N hands" / "Show fewer", that opens the rest in place (`.log.expanded`; the cap applies only while collapsed); a replay page passes `gameLink={false}` so its log never links to itself. The replay page's header label is read as a date too ("REPLAY · <bare id>" as well as "live game <id>").

- 2026-09-23: Models page reworked around models, not seats (the heading said "5 seats, 5 models", wrong once more models are tested). Server: `ModelsTable.models: ModelSummary[]` — each model's record across every game and seat it played, computed exactly by renaming its seat to one id in a copy of each game's hands (`renameSeat`) and running the same `record()` the seats use; ranked by chips per 100 hands (bb/100), since models will have played very different numbers of hands. Page: one ranked board — model, maker, the seats it sat in (by character, so pre-rename `jev` logs show as HEX once), style line; HANDS (flagged "few hands" under 100), WON / 100 HANDS, OFF THE TRUTH with its lean, TIME and COST per move — plus one line of method linking Research. Removed as redundant: the seat dossiers (repeated the board's name, model and style three times), the long method paragraph (Research has it). Site footer added to every page (`SiteFooter`, from the design's Research footer: logo, its line, the sections, by-line), paper-coloured on Research, a snap point of its own on the phone broadcast page so the snapping page can rest on it; Research's own footer removed. `NAV` moved to `lib/nav.ts` — a value exported from a 'use client' file reaches a server component as a reference, not an array. Note: Research's headline and figures still name seats; worth moving to models the same way.

- 2026-09-23: REGRESSION FIXED — seek bar invisible on real phones. Cause: the table's screen was sized by arithmetic (`100svh − 53px header − 61px bar`) so the bar ended exactly on the bottom edge, and it had no snap point of its own; if a device rendered the header or bar a few px taller, the bar sat just below the fold at the table snap and under the sticky header at the decision snap, so there was no resting position that showed it. Reproduced by forcing the table past the screen: bar 0px visible. Fix: on phones `.seek` is `position: sticky; bottom: 0` (+ safe-area inset), so it holds the bottom edge whenever its place is below the fold and scrolls away once past the table — same test now 61px (fully) visible; verified it does not float over the decision or log. Lesson for this layout: don't let visibility depend on exact pixel sums; make things that must be seen sticky or snap targets.

- 2026-09-23: last-decision card rebuilt from the user's second design zip ("Artificial Bluff Design Revamp (1)", `DecisionCard.tsx` + `decision-phone.css`), and applied at every width on the user's instruction (the pack scoped the new claims layout to phones). The card now names the hand and street beside the panel title, identifies the seat with its mascot and position, reads the move as a gold pill, sets AI SAID against REALITY side by side with a bar each (the captions for those two give way to the bars), runs AI CONFIDENCE full width underneath, and ends in three labelled cells — ANSWERED BY / THIS MOVE TOOK / THIS MOVE COST — since the players panel carries the running averages. The pack's TSX was missing the opening tag of the row holding the mascot, which the port restores. The phone card sits at its natural size (the pack is explicit that stretching it to the screen is what made the tall empty boxes), and the section shrinks with it so nothing scrolls to a screen of empty panel.

- 2026-09-23: the phone hand log is bounded by what it holds, not by a scrollbar: the three newest hands, six rows each, then an "Older hands" link to that game's replay (`.all-hands.older`, hidden on wider screens where the whole log is on the page). It stays one screen however long the game runs — the home page went from 3,740px to 2,368px and stops growing. The seat that hangs off the bottom rim also has a guaranteed gap above the seek bar now (stage bottom padding 76px, the felt capped to leave room for it) instead of relying on slack.

- 2026-09-23: phone follow-ups. The header is sticky (`--header-h: 53px`, `scroll-padding-top` so a section rests under it, not behind it); the table screen is sized to end exactly at the bottom edge (`.stage` min-height `100svh - header - 61px`, 22px top padding so the top seats don't slide under the header, felt capped at `(100svh - 200px) * 404/610`); the decision's three figures stretch to fill the screen instead of floating in the middle of it (193px each at 812); and the hand log is one long section rather than a box that scrolls inside a snapping page — a snap area taller than the screen is left free by the spec, so the page scrolls through it without fighting.

- 2026-09-23: the phone broadcast reads as three screens. `.stage-grid` becomes `display: contents` inside a column, so the seek bar sits between the table and the last decision (where it belongs on a phone) without changing the desktop markup; the table, the decision and the hand log each carry `scroll-snap-align: start` and are sized to one screen, with `scroll-snap-type: y mandatory` on the page — safe only because every section fits: the felt's width is capped at `calc((100svh - 250px) * 404 / 610)` so the table and its bar always share one screen, and the log has a fixed height and scrolls inside itself. The decision's three figures are stacked rows (label and caption left, a 30px number right) instead of three slivers side by side. Desktop is untouched (snap none, figures in a row).

- 2026-09-23: phone header back to one row (the second line I added for the programme cost more height than it saved): logo, the LIVE/REPLAY tag, what is playing and the sound sit beside the menu button, everything shrunk to fit, and the programme's name is the one thing that ellipses. The menu keeps the same place on pages with no programme (`header.site:not(:has(.site-status:not(:empty))) .menu`). The NEW HERE explainer is not shown on a phone at all — it cost more of the screen than the table, and How it works is in the menu. Home on a phone: header 53px, page 1,417px (from 1,604).

- 2026-09-23: `pnpm dev` opened from another device on the network (http://<lan-ip>:3000) rendered but never hydrated — Next 16 blocks dev requests from an origin it wasn't told about, so the feed never connected and the table read OFF AIR while localhost was fine. `next.config.ts` now lists this machine's own IPv4 addresses in `allowedDevOrigins` (plus anything in `DEV_ORIGINS`). Dev only; a build ignores it.

- 2026-09-23: the broadcast screen now holds one height. The side column used to set the grid row, so the seek bar sank ~180px as the hand log filled; the table sets the row (as in the design, where all three columns are the felt's 721) and the log scrolls inside what the decision panel leaves. The decision panel holds the height of its tallest form (Jev's five option bars, 344px) and a reasoning quote is clamped to five lines, so the hand log's first line never jumps; the seat's action bar is a fixed 20px instead of 18-20. Measured steady over 40 s at 1100, 1280 and 1440: grid, side, decision, log, seat pill, seek-bar offset and page height all constant.

- 2026-09-23: site-wide regression sweep after the design port. Fixed: the standalone replay screen never passed its worked-out true chance to the panel (REALITY read "-"); seeking back on the live page showed no true chances at all (the server sends equity for the present only), so `feedAt` and the play-on step now take the same equity source; the backlog fetch was live-only and stopped a replay ever having a seek bar, and once fetched it had to be cut at `joinedAt` or the log showed the game's ending while the table was mid-hand; FIRST TO ACT was cut off in the seat pill on a phone. The browser's equity is memoised by `equityKey` (`apps/web/lib/equity.ts`), because dragging the bar rebuilds the screen every frame: 4-13 ms a rebuild over a 652-event game. Checked at 1280 and 375: no overflow, no unstyled elements, no console errors of our own.

- 2026-09-23: page styles moved into CSS modules (`app/models/models.module.css`, `app/replays/replays.module.css`, `app/research/research.module.css`, `components/play/run.module.css`); `app/globals.css` now holds only the shell and the broadcast screen, guarded by `apps/web/test/styles.test.ts` (a page-only class in globals fails the build). This followed two collisions where a page class ('.card', then '.board') silently broke the table. Seat pill redesigned: mascot 54px on the card itself (no box), name/position/stack stacked beside it, cards and last action below; 150x112 instead of 172x124. Sound is an icon beside the LIVE tag; the seek bar shows for replays too; every page is capped at the design's 1280 and centred.
- 2026-09-22: UI revamp review fixes: hand pots are the chips actually awarded (were the winners' net gain: a split 825 pot showed as 25), split pots credit each winner their own share, honesty split into average error (accuracy) and leans (bias) everywhere, `/api/hands` is live-games-only and skips scoring for a running game (a page view used to burn ~26 s of CPU and stall the feed), summary cache capped at 20 games, true chances sampled above 200k evaluations (new `scoreDecisions` options), one hand per biggest-pot tie, plural-safe headlines, no false 'in progress' badge, deep links use the index's own startSeq, focus rings + light color-scheme + AA contrast on the research page, and table-driven summary tests.
- 2026-09-22: UI revamp built on `feat/ui-revamp`: 6a portrait-stage home (players panel, decision card, grouped hand log with tags and times, seek bar with hand ticks, phone layout, coloured mascots, Archivo/Chivo Mono), 6b Run a table (empty seats, game options, estimate panel, keys card), 6c Replays (hand index with rule-based tags and headlines from `/api/hands/:id`, filters, featured hand, ?hand=N deep link), 6d Models (`/api/models` aggregate: chips, bb/100, win rate, latency, spend, honesty gap, play style), 6e Research (light theme, author intro as written, figures generated from finished games with a demo-scale caveat, study reports). New core field: SeatView.startingStack. 460 tests, production build clean.
- 2026-09-22: UI revamp started (`feat/ui-revamp`) from the user's design zip (Home portrait stage + phone, Replays, Models, Run a table, light Research). Decisions: mascots coloured as in the design (JEV gold, PILL cream, BLOCK red, DRIP teal, NIMBUS purple); Research keeps the user's personal intro as written (name, bio, GitHub, LinkedIn, email). Corrections: all mock numbers/model names/blurbs/headlines/claims replaced by real data (Models = new aggregate endpoint; Replays headlines rule-based; Research from study report JSON, empty until a study runs); Jev shows option bars not a quote; 'Spent' not 'tokens spent'; plain seat names; one-row board; honest cap wording; per-provider keys + Sign in with OpenRouter; PDF flip-book replaced by the HTML report + exports. Phases: 6a design system + Home, 6b Run a table, 6c Replays (hand index), 6d Models, 6e Research.
- 2026-09-22: Plan 5 final review fixes: relay reads streamed bodies up to 64 KB and rate-limits before reading, exact path, IPv6 /64 keys, per-minute client and total caps, aborts with the page, no redirects, null origin 403; Caddy body cap + CSP connect-src; LocalTable counts timed-out paid decisions at estimated price (cap can't be overspent without limit); honest cap wording, rough estimate; model-list failure no longer blocks Jev/bot tables (Retry); keys saved/forgotten immediately + Forget button; setup kept across OpenRouter sign-in; errors shown; no trimming while typing; one table at a time. 452 tests.
- 2026-09-22: Plan 5 implemented subagent-driven on `feat/plan-5-byo-table` (b7aa70f..61a1895 + docs); every file byte-identical to the verified reference; 443 tests; production build lists /play and /api/typesafe/[...path]. Open item: ask TypeSafe to allow browser calls (CORS), then remove the relay.
- 2026-09-22: Plan 5 (run your own table) written from a verified scratch reference (443 tests, production build OK, bot game + relay + OpenRouter sign-in redirect checked in the browser): `docs/superpowers/plans/2026-09-22-plan-5-byo-table.md`. Decision: ask TypeSafe to enable browser calls (CORS); meanwhile Jev seats use a stateless, clearly labelled relay. Offline `pnpm install` prunes other platforms from the lockfile: always install online.
- 2026-09-22 (user decisions): real runs — smoke test only (5 hands, cap $0.25) once keys are in .env, then ASK before the smoke study (~$1) and main study (~$25). Deployment: user's own VPS (Docker + docker-compose + Caddy HTTPS + setup guide). Smoke line-up: lineups/live.example.json (copied to lineups/live.json). UI requests: proper card faces (corner indices + pips), live time-shift seek bar with dimmed LIVE button to jump back, remove duplicate LIVE text, readable action log, label the seat % (true win chance).

- 2026-09-22: Plan 4c merged to master and pushed. All planned pieces done (engine, players, study, report, live server, mascots, web). Next candidates: real smoke run (needs keys + go-ahead), deployment, deferred TODOs.

- TODO (Plan 4c re-review, minor): ReplayScreen restart when index is already 0 doesn't re-apply game_started (practically unreachable; add a generation counter).

- TODO (Plan 4c review, deferred): /research charts (links to the full HTML report for now); running cost on seats (scoreboard has it); error boundary around applyEvent for unknown future event types; badge truncation at phone width; Jev comet replays on a mid-hand join.

- 2026-09-22: Plan 4c written from a verified scratch reference (408 tests; next build clean; checked in the browser live, replay, research, about, phone width). Decisions: SSE via Next rewrite (streams fine); `@ab/core/view` export for the browser; running latency total in the view; compact rim seats, sidebar below table under 1200 px, 2-column seats under 720 px; synthesised muted-by-default sounds; browser replays without true equity.

- 2026-09-22: Plan 4b merged to master. Next: Plan 4c (Broadcast web UI).

- Notes for Plan 4c (Plan 4b re-review): reduced-motion viewers see a brief animation before the resting pose (hydration-safe default); a restarted one-shot snaps (no blend); an explicit cueKey must change whenever the cue does; one stale frame on unfreeze.

- TODO (Plan 4c, from Plan 4b review): next.config transpilePackages ['@ab/mascot']; /about must include the full bloub MIT notice text; profile five animated mascots (write attributes via refs or 30 fps idle if janky).

- 2026-09-22: apps/server test flake identified (director test > 5 s default under full-suite load) and fixed with a 30 s testTimeout (a62efc4).

- 2026-09-22: Plan 4 split again: 4b mascots (package), 4c web UI. Plan 4b written from a verified scratch reference (391 tests). Decisions: vendor only bloub's clock-free engine (MIT, b4bb3c1) with its tests; shape rule = orbit spins the player's shape, circle-drawn states take the shape at that radius, glyphs unchanged; white rings via saturation 0; React `<Mascot>` with a clock-free `MascotDriver`; explicit `id` prop for separately rendered mascots (useId collides across render calls).

- 2026-09-22: Plan 4a merged to master. Next: Plan 4b (Broadcast web UI + bloub mascots).

- 2026-09-22: Plan 4a final re-review: ready to merge. TODO (non-blocking): server lock read-then-write race (use writeFileSync flag 'wx'); lock left behind when start-up fails after taking it (taken over next start) and raw stack trace on refusal (print a clean message); replay cache never evicts (drop games that leave the queue).

- TODO (Plan 4a final review, deferred): daily spending cap across live games (a leaked admin token could start back-to-back games); `/api/health` mode during cooldown; start returning 201 even if the game fails immediately.

- 2026-09-22: Plan 4a Task 6 implementer saw one transient apps/server failure under a concurrent full-workspace run (real-timer tests); not reproduced in 3 clean full runs. Watch for it; if it recurs, identify the test and make its timing robust.

- 2026-09-22: Plan 4 split: 4a live server (headless, testable) and 4b web UI + mascots. Plan 4a written from a verified scratch reference (294 tests). Decisions: SSE instead of WebSocket (receive-only, no dependency); shared `applyEvent` table-view reducer in core; random 16-byte deck seed per live game (game ids are public); on-screen equity exact when cheap else seeded 20k-board estimate (exact preflop blocked the event loop / hung tests); `pnpm live` (pnpm server is a pnpm built-in); runtime tsx (resolves the Plan 1 open question).

- 2026-09-22: Plan 3b merged to master (0d46196). Next: Plan 4 (live server + Broadcast web UI + mascots). master not yet pushed to GitHub since the merge.

- 2026-09-22: Opus review of Plan 3b Tasks 1-4 (equity, outcomes A/C, calibration math confirmed correct). Adopted: calls scored by equity vs winnable-pot odds (mirror of folds); per-action calibration published per action type only (pooling rewards passive play); auto-played decisions excluded from latency/tokens/cost per decision; headline fallback rate = model-output failures; VPIP/PFR exclude walks; hands grouped by game+hand id. Reference: analysis 20, study 47 (256 total).

- 2026-09-22: Plan 3a merged to master (04bc98f) and pushed with the branch to github.com/0xjba/Artificial-Bluff. Plan 3b written from a verified scratch reference (251 tests). Decisions: outcome C treats folded hands' cards as dead (exact equity given every dealt card); per-action score = fold right if equity < pot odds, other actions right if stack didn't shrink to hand end; exact preflop equity is batched per (deal, board) over live subsets (75 s → 12 s for 200 hands); focus player for contrasts = first jev seat.

- 2026-09-21: Plan 3a Task 1-3 stats follow-up committed (f0b5424, byte-identical to reference). Task 4 committed (f7c2b56, spec ✅). Opus review of Task 4: approve with fixes → deterministic check schedule (every boundary in order; resume from last checkpoint; results pinned to the stop boundary via study_ended.analysedGroups), ci_target wins over budget_cap, claimGame + --takeover (no double runs), prereg must match config, budget overshoot documented, dead format check removed, 7 new tests. Prototyped in reference: engine 104, players 44, core 35, study 35. Follow-up fix to be applied on branch next, then Task 5.
- 2026-09-21: Task 5 committed (80b8083, identical to reference). Opus re-review of Task 4 fixes: approve with fixes → read progress after claimGame; early return uses study_ended.analysedGroups; minGroups multiple of checkEvery. Not done (by design): checking Player kind/model against the pre-registered seat (tests deliberately use bots in mock seats; the CLI builds players from the same line-up). Reference: core 35, study 35.
- Note (Plan 3b): the pre-registration record gained `contrasts` + `outcomes.perAction`, so studies created before it (only mock/demo data in data/*.db) won't resume under the same id: delete the db or use a new id.
- TODO (after-merge polish, final re-review): `run --live` on a finished study should return before the REAL RUN line/createPlayers; ignore a second SIGINT within ~100 ms of the first (tsx re-sends SIGINT after 30 ms during slow sync steps).
- TODO (from final review, deferred): mock seats all play the same TAG strategy, so mock rehearsals always give 0 ± 0 (give mocks varied styles); fixed-size studies that meet the CI report ci_target rather than max_groups (cosmetic); --takeover trusts the user (could store pid/host); main study at $25 will likely end on budget_cap (~200 groups) — choose target/budget knowingly before pre-registering.
- TODO (minor, from review): budget-cap-then-ci_target test; stronger concurency-skip test (checkEvery 4, ~200 groups).
- TODO (minor, from review): record code version (git SHA) with a study without breaking resume (e.g. in game_started, not the prereg hash); explain in the report that in-flight hands after a CI stop are logged but not analysed.

- 2026-09-21: Decision (from stats review of Plan 3a): stopping rule and published CIs use Student t over neighbour blocks (bootstrap only as sensitivity check); CI rule never fires before 10 blocks (40 groups) unless fixed-size; every check logged; pairwise claims need paired contrasts + Holm (Plan 3b). Flag to user.

- 2026-09-21: Plan 2 built on feat/plan-2-players — 11 tasks, each spec (diff vs verified reference) + quality reviewed (opus for the fairness-critical ones). Reviews caught: short-stack toCall/pot-odds and drifting SPR, bot folding aces, AA=KK, LLM truncation/reasoning-token/percentage-rescaling/win-wording issues, Jev asymmetric retries + unsourced price, SQLITE_BUSY lost events with concurrent writers, non-canonical config hashes, runner crash paths and latency skew, stuck 'running' games, soft budget cap, API keys visible on player objects.

- 2026-09-21: Plan 1 complete on feat/plan-1-engine — 9 tasks, each spec+quality reviewed; reviews caught deriveSeed collision, malformed-card evaluation, pot crash, 3 NLHE rules bugs, menu sizing bias, unvalidated tournament results, duplicate-seating neighbour bias, consumer typecheck. 99 tests.

- 2026-09-21: Decision: duplicate groups vary base seating (multiplier k = 1 + g mod 4 for 5 players) so neighbours balance over 4-group blocks; study stop checks in multiples of 4. Spec §4/§6 updated. Flag to user.

- 2026-09-21: Decision: adopt TDA Rule 43 (several short all-ins adding to a full raise reopen betting). Recorded in spec §4.

- 2026-09-21: Salvage done; design approved; Plan 1 written, verified in scratch (64 tests pass); execution started with subagent-driven development.
