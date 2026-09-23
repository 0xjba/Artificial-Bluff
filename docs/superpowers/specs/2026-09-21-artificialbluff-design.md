# artificialBluff — Design Spec

Date: 2026-09-21 · Status: approved

## 1. Purpose

artificialBluff is an off-chain, revamped successor to "House of TEN" (an on-chain AI-vs-AI Texas Hold'em game the
author built at TEN). It is two things at once:

1. **A research benchmark** comparing TypeSafe's **Jev** (a "System One" model returning typed, calibrated
   decisions) against LLMs on a hidden-information, adversarial task. Published measures: results (bb/100),
   cost per decision/hand, latency per decision, calibration, invalid-output rate.
2. **A spectator game**: live games on demand, with recorded replays in between, in a TV-broadcast style.

Primary audience: Jev / TypeSafe and its developer audience. It must read as a serious, fair experiment, not a toy.

Salvaged material and its provenance are documented in `SALVAGE.md`. The Solidity contracts are used as a rules
reference only (they contain known bugs). The old Python agents are not reused except their prompt as a baseline.
Jev API reference is saved in `docs/jev/`.

## 2. Decisions summary

| Topic | Decision |
|---|---|
| Language / shape | One TypeScript pnpm monorepo, Node 20+ |
| Information fairness | Identical observation for every player; code pre-computes arithmetic; no equity hints (ablation later via config) |
| Luck control | Duplicate format for the study; separate live table for spectators |
| Line-up | Jev + 2 frontier LLMs + 1 small/fast LLM + 1 open-weight LLM (5-max), all configurable. Two line-up files: research (frontier models TypeSafe benchmarked: Fable 5.1, GPT-6 Astra; ~$1.30/live game) for the study and recorded games; live (Sonnet 5, GPT-5.6 Sol, …; ~$0.32/game) for everyday live games |
| LLM access | OpenRouter |
| Action space | One shared menu of realistic sizes, shown as chip amounts |
| Calibration | Every player states win probability + confidence per decision; per-player curves on site, per-action analysis in report |
| Study budget | Free mock run → ~$1 smoke (~100 hands) → main run with CI-based stop, budget cap ~$25 (overshoot ≤ decisions in flight) |
| Live games | On demand, turbo structure, ~$0.50/game estimate, per-game cap; replays when idle |
| Spectator betting | Not in v1 |
| Brand | "artificialBluff", Broadcast direction (felt green, brass, Barlow) |
| Mascots | bloub engine (MIT), neutral white, distinct shape per player, shape kept through all animations |
| Names | Persistent character + always-visible model badge (HEX, PILL, BLOCK, DRIP, NIMBUS). HEX was JEV until 2026-09-23: the characters are the house, so any model can sit in any seat. Old event logs still carry the seat id `jev` and are mapped to HEX. |

## 3. Architecture

```
artificialBluff/
├─ packages/
│  ├─ engine    pure NLHE rules: deck, betting, side pots, showdown, tournament. No I/O.
│  ├─ players   Player interface + Jev / LLM / Bot / Mock implementations
│  ├─ core      table runner, event types, SQLite event log, stats
│  └─ mascot    vendored bloub engine (MIT, attributed) + React wrapper
├─ apps/
│  ├─ server    live table + replay feed over WebSocket; admin "start game" endpoint
│  ├─ study     CLI: duplicate matches, budget cap, resume, report generation
│  └─ web       Next.js spectator site (salvaged presentational components, new brand)
```

**Table runner** (shared by live and study):
```
engine state → observation for acting seat (own hole cards only)
            → player.decide(observation)   [timeout → safe default]
            → validate: chosen option ∈ legal menu
            → engine.apply → events → SQLite log → WebSocket (live)
```
- Live mode: 2–4 s pacing per action, turbo structure, per-game cost cap.
- Study mode: no pacing, N tables in parallel, seeded decks, duplicate rotation.

**Event log is the single source of truth.** Events: `game_started` (with the config hash), `hand_started`,
`cards_dealt`, `turn_started`, `decision`, `street_dealt`, `showdown`, `pot_awarded`, `hand_ended`, `game_ended`
(its `reason` covers last player, hand cap, budget cap and interruption).
A `Decision` records: seat, player id, model + version, legal options, chosen option, per-option probabilities
(Jev), win probability, confidence, reasoning (LLMs), latency ms, input/output tokens, cost USD, fallback flag,
retry count. Live view, replays and research all read this log. Seed + decisions reproduce a hand exactly.

**Storage:** SQLite (single file). Secrets (`OPENROUTER_API_KEY`, `TYPESAFE_API_KEY`, `ADMIN_TOKEN`) only in `.env`,
git-ignored from the first commit.

## 4. Game engine and formats

**Rules:** standard No-Limit Hold'em, implemented correctly (not ported from Solidity):
- 5 seats; button rotates; correct heads-up rules (button posts SB, acts first preflop). Live tournaments use a simple
  moving button (next live seat; no dead-button rule), so after a bust a player can occasionally post the BB twice.
- Standard min-raise rule; an incomplete all-in raise does not reopen action for players who already acted,
  unless several short all-ins together amount to a full raise (TDA Rule 43, cumulative).
- Side pots by contribution level; odd chip to first winner left of the button.
- Hand evaluation via a proven evaluator library, cross-checked by a brute-force reference in tests.
- Seeded Fisher–Yates shuffle; cards as two-character strings such as `"As"` (no "0 = empty" sentinel).
- Timeout: check if legal, else fold. Live turn limit 30 s; per LLM call timeout ~20 s.

**Action menu** (identical for all players; only legal options offered; options at the same amount, or within 5%
of one already offered or of all-in, are merged; amounts rounded to a 25-chip unit, or to the small blind when the big blind is
not a multiple of 25). Because merged ids vary by spot, every decision records its chip amount and analysis uses
amounts, not option ids:
- Preflop unopened: min-raise, open to 2.5 / 3 / 4 bb plus 1 bb per limper, all-in.
- Preflop facing a raise: min-raise, re-raise to 2.5× or 3× the current bet plus 1× per caller (covers 3-bets,
  squeezes and ~2.5× 4-bets), all-in.
- Postflop: min-raise, bet/raise ⅓, ½, ¾, 1× pot, 1.5× pot overbet, all-in.
- Always: fold (when facing a bet), check or call.

**Formats:**

| | Live game | Study |
|---|---|---|
| Structure | Turbo tournament to one winner | Duplicate cash-style hands |
| Stacks | 3,000 (60 bb) | Reset to 100 bb every hand |
| Blinds | 25/50, up every 8 hands: 50/100, 75/150, 100/200, 150/300, 200/400, 300/600, 400/800, 600/1200, … | Fixed 50/100 |
| Length | ~60–80 hands; hard stop at hand 120 (chip leader wins) | CI-based stop or budget cap |
| Pacing | 2–4 s per action | None, parallel tables |

**Duplicate:** each deck seed is played 5 times, cyclically rotating players through all seats, so every player gets
every seat (and posts SB, BB and holds the button once) with the same cards. Pure cyclic rotation would keep the same
neighbours forever (a bias with five different opponents), so each group also varies its base seating order: group g
seats players[(k·i) mod 5] with k = 1 + (g mod 4). Over every block of 4 groups each ordered pair of players sits side by
side exactly once; the order id is recorded with each hand. (Non-prime player counts fall back to a seeded random base
order per group.) The seed group is the statistical unit. Results in bb/100 with 95% Student t CIs over neighbour blocks of seed groups (bootstrap as a sensitivity check; see §6).

## 5. Players

**Observation** (identical for all, ~300–400 tokens, compact JSON):
street; own hole cards; board; own position (BTN/SB/BB/UTG/CO); each seat's position, stack, status, bet this
street; this hand's action history; computed facts (to call, pot odds %, effective stack in bb, SPR); the option
menu `{ id: "Raise to 300" }`. No cross-hand memory. `hints.equity` flag (default off) adds an equity estimate for
the ablation. No personality/style text in the study; live characters are display-only.

**Jev adapter** (`@typesafe-ai/sdk`, pinned model version, e.g. `jev-1.13.0`): one `systemOne` call per decision.
- `action`: Choice over legal option ids (each described with its chip amount).
- `win`: Noul, worded literally: "The acting player wins this pot, either at showdown or because all opponents fold."
- Plays the top choice (sampling from probabilities is a later ablation). Records all option probabilities,
  choice confidence, win probability, and the model version that answered.
- No SDK retries (the LLM seats get no infrastructure retry either); SDK timeout set above the table's decision
  timeout so one runner timeout governs both. API answers outside the offered options are infra faults, not Jev's.
- Cost: input tokens × $0.042/M, output free — source: TypeSafe launch post (typesafe.ai/blog/introducing-system-one-models-and-jev),
  read 2026-09-21; recorded in each game's config.
- Disclosure for the write-up: TypeSafe recommends decomposing "best action" into atomic questions; the benchmark
  asks it as one Choice for parity with the LLMs. A decomposed Jev design is a separate pre-registered ablation.

**LLM adapter** (OpenRouter):
- System prompt: rules summary, option semantics, output schema. Baseline wording derived from the salvaged
  prompt (`SALVAGE.md` §3), fixing its known defects. (At ~270 tokens it is below providers' prompt-caching minimums,
  so no caching.)
- Output: `{"action":"<option id>","win_probability":0-1,"confidence":0-1,"reasoning":"≤120 chars"}`; JSON-schema
  mode where supported; temperature 0.3; reasoning off (`effort: none`) and max 150 output tokens, or for models that
  always reason `effort: low` (hidden) with 1,500. Reasoning tokens are recorded per decision as evidence.
- Invalid, empty or refused output → one retry quoting the specific error (Jev cannot produce invalid output; the
  retry's cost and latency count against the LLM). A reply truncated at max_tokens fails without retry. Then fallback
  check/fold flagged `fallback:true` with a kind: model / infra / timeout / auto, so provider outages aren't blamed on
  models. Probabilities outside 0-1 are rejected, never rescaled.
- A free pre-flight against OpenRouter's model catalog rejects unknown models and sets per-model request flags
  (structured output, reasoning parameter, temperature).
- On timeout the runner aborts the call but still records what it had already cost (short grace period).
- Temperature 0.3 is sent only where the model accepts it. Via OpenRouter (checked 2026-09-21) Anthropic and OpenAI
  models don't list `temperature`, so those seats run at provider default. The adapted per-seat flags are recorded
  in each game's config; disclose in the write-up.

**Same questions for both:** Jev's win Noul and the LLMs' `win_probability` use one shared condition ("win this hand,
either at showdown or because every opponent folds"), and both get the same option semantics.

**Calibration outcome (user decision 2026-09-21), identical for all players:**
- Headline (A): the player's share of the **main pot** — 1 if they win it alone, 1/k if split k ways, 0 if they lose
  or fold at any point in the hand (including later folds). Side pots are ignored.
- Second chart (C): the player's expected main-pot share at the moment of the decision, against the players still
  in the hand, computed from everyone's actual hole cards (exact enumeration of the remaining board; folded hands'
  cards are dead), so later actions and board luck don't count. Note for the write-up: Jev's `confidence`
is derived from its option probabilities, the LLMs' is self-reported — report them separately, not as one metric.

**Bots:** Random, CallingStation, simple rule-based TAG, MockLLM (deterministic, free) for tests and $0 runs.

**Measured per call:** wall-clock latency; LLM cost from OpenRouter-reported usage/cost; Jev cost from tokens ×
published price; model version.

## 6. Study runner and results

`pnpm study prereg|run|status studies/<name>.json [--mock]`. Config (JSON): line-up, master seed, format, decision
timeout, target CI half-width, min/max groups, check interval, bootstrap resamples, budget cap, concurrency.
Concurrency N means at most N hands in flight, each asking one player at a time, so at most N requests in flight;
that is far below provider rate limits (e.g. TypeSafe 1,200 req/min), so no separate rate limiter.
Budget and concurrency are not part of the pre-registration (they only decide how far a run gets).

- **Pre-registration:** config + hash written to the log before hand 1; report quotes the hash.
- **Budget:** running cost, checked before every hand and every decision; decisions already in flight finish
  (overshoot ≤ concurrency decisions); hands cut off by the cap don't count and are replayed on resume.
- **Resume:** re-running skips completed (seed, rotation) pairs and reuses the pre-registered line-up (never
  re-adapted to a newer model catalog, which would change the hash).
- **Stopping:** every `checkEvery` groups (a multiple of the neighbour block), over the completed prefix of groups in
  whole blocks, compute each player's 95% **Student t** CI (df = blocks − 1) of bb/100; stop when all half-widths ≤ target.
  Never before `minGroups`, which must be ≥ 10 blocks (40 groups for 5 players) unless the study has a fixed size.
  Every check is logged (`study_checkpoint`). Checks run at every boundary in order, so the stopping point depends
  only on the data (not concurrency or interruptions); results use the stopping boundary (`analysedGroups`). A met
  rule wins over a budget cap. The budget cap stops a run (overshoot ≤ decisions in flight); cut-off hands are
  replayed on resume. Only one process may run a study (`claimGame`; `--takeover` after a crash).
  (A statistics review found percentile-bootstrap CIs cover only ~84–90% at 5–10 fat-tailed blocks, and ~70% after
  width-based stopping; t CIs stay near 95%.)
- **CI unit:** neighbour blocks (4 groups for 5 players; `neighbourBlockSize`). The published CI is the t interval;
  a percentile bootstrap over blocks is reported as a sensitivity check. Per-player CIs are marginal, not
  simultaneous: pairwise claims (e.g. Jev vs a model) use paired contrasts with a Holm correction (Plan 3b).
- **Stages:** `--mock` ($0) → smoke, 40 hands (~$1) → main (cap ~$25). Paid runs need an explicit `--live`.
  Mock rehearsals test the plumbing, not the statistics: identical mock strategies break exactly even.

**Outputs:** static HTML report, CSV/JSON of every decision, and the same charts on the site's `/research` page:
results (bb/100 ± CI, Holm-corrected paired contrasts of Jev vs each model), cost ($/decision, $/100 hands), latency
(p50/p95), win-probability calibration (reliability curves with 10 bins, Brier, ECE; outcomes A and C), per-action
calibration (confidence vs whether the action was right, reported per action type only: folds and calls by all-in
equity against the pot odds of the winnable pot, checks and raises by whether the player's stack shrank afterwards),
invalid/fallback rate by kind (headline: model-output failures), play style (VPIP and PFR without walks, AF, WTSD).
Per-decision cost, tokens and latency leave out auto-played decisions. `pnpm study report <study.json> [--mock]` writes `report.html`
(self-contained), `report.json`, `decisions.csv` and `decisions.json` (Plan 3b; pure functions in `@ab/analysis`).

## 7. Live server, replays, site

**Server states:** `idle → live → ended → idle`; one live table in v1. `pnpm live [--mock]` (Plan 4a; `tsx`, no build).
- `POST /api/admin/games` with `Authorization: Bearer ADMIN_TOKEN` starts a live game (hidden admin button or curl);
  `POST /api/admin/games/stop` ends it after the hand in progress. Admin API off unless `ADMIN_TOKEN` is set.
- Deck seed: 16 random bytes per live game (never derived from the public game id). A running game's config is
  withheld (`/api/games/:id` config null) and published once it is over. A live game's events so far are readable (the
  feed already showed them; no seeds), so live viewers can seek back ("time shift": a seek bar
  and hand steps; the past plays on at replay pace until it catches up; the LIVE tag dims meanwhile and jumps back). A study's events stay withheld (409) until it is over
  for good: every rotation of a duplicate group is dealt the same cards.
- Idle: replays through the same event stream, labelled "REPLAY": past live games + an auto-picked highlight reel of
  study hands (biggest pots, all-ins, largest Jev-vs-LLM win-probability disagreements).
- Per-game cost cap: game ends after the current hand; chip leader wins; UI shows "budget cap reached".
- Feed: Server-Sent Events at `/api/feed` (spectators only receive, so SSE: plain HTTP, no dependency, browsers
  reconnect by themselves; decided in Plan 4a instead of WebSocket). A snapshot on connect (channel + table view built
  by `@ab/core`'s `applyEvent`, the same reducer the web UI uses), then events and true-equity updates. Spectators see
  all hole cards; players are programs and never read the feed.
- True equity on screen: each live player's chance of winning the main pot from here given every dealt card (outcome
  C); exact when cheap (≤ 200k evaluations), otherwise a seeded 20,000-board estimate flagged `estimated`.
- Crashed games are marked interrupted at start-up; SIGINT/SIGTERM stop the live game after its hand.

**Web (Plan 4c):** `apps/web`, Next.js 16 App Router; `pnpm web` (with `pnpm live [--mock]` on :8787). The browser
follows `/api/feed` through a same-origin rewrite and folds it with `@ab/core/view` (no database code in the bundle);
`seatMoment(view, id)` picks each mascot's spec §8 moment. Sounds are synthesised (Web Audio), muted by default.
Replays play in the browser (no true equity there; the live server computes it). `/research` reads `reports/`
(from `pnpm study report`) at request time and serves allow-listed report files. `/about` carries the full bloub
MIT notice.

**Pages:**
- `/` table (live or replay): seats with mascot, character name, model badge, stack, last action, last decision
  latency, running cost; decision lower-third (Jev: option probability bars + confidence; LLMs: reasoning text;
  both: stated win % vs true equity); scoreboard strip (cost, avg latency, fallbacks per seat); action log; sounds
  + mute.
- `/research`: study charts, plain-language method, data download.
- `/replays`: past games list.
- `/about`: what artificialBluff and Jev are, how fairness is ensured.

Removed from salvaged frontend: wallet/wagmi, token betting, claims, chain polling, snapshot-diff inference, all
TEN branding and parody personas.

### 7.1 Run your own table (Plan 5)

- **/play:** visitors seat Jev (first seat only), any supported OpenRouter model, or a free bot in each of the five seats.
  They watch a turbo tournament on the usual broadcast screen.
- **Where the game runs:** in the visitor's browser: `LocalTable` with a `MemoryStore`, through `@ab/core/browser`, which
  never imports SQLite or Node. Nothing is stored on our server, and browser tables are never mixed into research
  results. Closing the tab ends the game.
- **Keys:** kept in the tab's session storage, or in local storage if the visitor ticks "remember on this device".
  "Sign in with OpenRouter" uses OAuth PKCE: no key pasting, and the key is user-controlled.
- **Model seats** call OpenRouter directly (OpenRouter allows browser calls from any origin).
- **Jev seats:** TypeSafe's API refuses browser (cross-origin) calls, so Jev calls go through a stateless relay,
  `POST /api/typesafe/v1/systemone` on the web app. It forwards the visitor's key per request and never stores or logs
  it. Limits:
  - only the `v1/systemone` path;
  - same-origin callers only, and redirects are never followed;
  - streamed bodies are cut off at 64 KB (Caddy caps them too);
  - 120 calls per minute per client (IPv6 counted per /64), with a total cap of 3,000 calls and 20,000 clients per
    minute;
  - the upstream call is dropped when the page gives up.

  The page labels the relay next to the TypeSafe key field. Open item: TypeSafe to allow browser calls, then remove
  the relay.
- **Supported models** come from OpenRouter's public catalog:
  - text in and out, with `structured_outputs`;
  - no `:free`, `:batch` or `~alias` variants;
  - a fixed price of at most $0.02 per decision (estimated at 800 prompt and 80 reply tokens).

  Ten well-known models are listed first. Request settings are adapted per model as in `adaptLineup`.
- **Cost:** the rough estimate assumes up to 120 decisions per paid seat. The spending cap defaults to $1 (range $0.10
  to $20) and ends the game once reached. It can go slightly over: the last decision runs before the cap is checked.
  Timed-out paid decisions, which providers may still bill without reporting a cost, count at their estimated price,
  so a slow model can't overspend without limit. "Stop after this hand" ends the game early.
- **Content-Security-Policy:** Caddy sends `connect-src 'self' https://openrouter.ai`, so an injected script
  couldn't send stored keys anywhere else.

### 7.2 Site design (revamp, 2026-09-22)

From the user's design pack, with mock, wrong and redundant parts corrected. Fonts: Archivo and Chivo Mono.
Mascots are **coloured** per seat (HEX gold, PILL cream, BLOCK red, DRIP teal, NIMBUS purple), which supersedes
the earlier white-only rule; the colour is also the seat's accent on bars and cards.

- **Live (/)**: portrait felt, seats on the rim (bottom seat first), pot and board in the middle, "who is playing"
  panel on the left (model, stack, net result, win chance, average latency, spend), last decision and hand log on
  the right, seek bar with a tick per hand underneath, and a dismissible "new here?" line. The phone layout is the
  same one column by column. Seat positions are plain words ("Big blind", "Before dealer"); the board stays in one
  row of five; cards keep the real faces (corners, pips, court frames).
- **Replays (/replays)**: every hand of a game as a card, newest first, with filter chips (biggest pot, knock-outs,
  showdowns, Jev vs LLM, worst reads, split pots, timeouts), a featured hand, and a game picker. Tags and headlines
  are worked out from the log by `/api/hands/:id` (live games only, since a study's hands must stay secret and are
  far too many to summarise on a page view); a hand's pot is the chips actually awarded, and a split pot shows each
  winner's own share. A running game is listed without scoring, so the spectator feed is never blocked; the
  cache holds the 20 most recent games. "Watch" opens the replay on that hand
  (`/replays/<id>?hand=N`).
- **Models (/models)**: `/api/models` sums every finished live game per seat: chips won, bb/100, hands won, win
  rate (won or shared), average decision time, spend per decision, fallbacks, two honesty figures and play style
  (VPIP, PFR, aggression factor, WTSD). The honesty figures are kept apart: **average error** is the mean of
  |stated − true| (accuracy; nothing cancels) and **leans** is the mean of (stated − true), signed (bias). The site
  estimates the true chance from 20,000 sampled boards where exact enumeration would be dear (`scoreDecisions` takes
  `maxEvaluations`); the study still enumerates exactly. Seat dossiers repeat the style as bars. A note explains each
  measure. No personality blurbs: every line is measured.
- **Run a table (/play)**: line-up rows with a per-seat key state, free bots and empty seats (2 to 5 play), game
  options (blinds doubling every 10 hands, starting stack, pace, hand count), budget cap, an estimate panel (cost,
  decisions a hand, dearest and cheapest paid seat, run time), a keys card and a plain account of where keys go.
- **Research (/research)**: the one light page. The author's introduction, then figures computed from the finished
  live games (`/api/models`) with a headline generated from those numbers and a caveat that they are demo scale,
  then the study reports. Nothing is claimed that the data doesn't show; before any game has finished the section
  says so. Jev answers with a probability per option; the LLM seats state a win chance and confidence.

## 8. Brand

- **Direction C, Broadcast.** Felt `#0B2A24`, panel `#0E3029` / `#123A32`, rule `#1F4A40`, cream text `#F3EBDD`,
  muted `#9DB8AE`, brass accent `#E8B04A`, alert red `#D9534F`. Type: Barlow Condensed (display), Barlow (body).
- **Mascots:** vendored bloub engine (MIT, credited in `/about` and `LICENSE-THIRD-PARTY`). All bodies neutral
  white `#F5F3EE`; decorative rings/comet trails white (no rainbow). Distinct shapes: HEX hexagon, PILL capsule,
  BLOCK squircle, DRIP droplet, NIMBUS cloud. Engine change: narrative states keep the player's own body shape
  (`orbit` spins it instead of a triangle; states drawn as a circle draw the shape at that size; the "!" glyphs
  are unchanged). No circle and no black body, to stay clear of the xAI bot identity. Package `@ab/mascot`
  (Plan 4b): vendored engine (bloub `b4bb3c1`, MIT, `LICENSE-THIRD-PARTY`), cast, reaction cues, React `<Mascot>`;
  preview sheet `docs/brand/mascots.html`.
- **Mascot state mapping:** waiting → idle; deciding → thinking; Jev decides → comet; check/call → attentive;
  raise → excited; all-in → exclaim then burst; fold → unimpressed; win pot → laughing then orbit; big loss → sad;
  eliminated → sleep; timeout/fallback → confused.
- **Names:** character + model badge on every seat; research pages use model names. Badges from config.
- Preview renders: `docs/brand/mascots-v2-mono.png`.

## 9. Error handling

| Failure | Behaviour |
|---|---|
| LLM invalid / empty / refused output | One retry quoting the error, then check/fold `fallback:true` (kind `model`) |
| LLM or Jev timeout, HTTP / network / provider error | No retry (same for both kinds of player); check/fold `fallback:true` (kind `timeout` / `infra`) |
| Provider outage in live game | After 3 consecutive fallbacks, seat auto check/folds for the rest of the hand; the lower third says "connection lost: seat auto-played" (timeouts, provider errors and invalid answers are named too) |
| Server crash, live | Game marked interrupted on restart; replay remains; no live resume in v1 |
| Server crash, study | Resume skips completed pairs; partial groups dropped and replayed |
| Budget cap | Checked before every decision: once reached, no further paid calls (the hand finishes as check/fold) and the game ends; overspend is at most one decision. Study: no new groups. Logged |
| Illegal engine operation | Throw (programming bug); unreachable through the menu |

## 10. Testing

- Engine unit tests for every rule in §4, plus regression tests for each salvaged contract bug.
- Property tests: thousands of random bot hands asserting chip conservation, card uniqueness, pot sums, termination.
- Evaluator cross-check against brute force on a large random sample.
- Determinism: same seed + decisions → identical event stream.
- Player adapters against recorded/mock responses (valid, malformed JSON, illegal option, timeout); Jev via mocked
  SDK. Real API calls only in the smoke run.
- Statistics validated on synthetic data with known answers (e.g. perfectly calibrated fake player).
- Web: component tests for the broadcast screen; one end-to-end test that plays a mock live game on the server and
  follows its SSE feed through the client reducer to the rendered screen; jsdom tests for replays, sounds and
  reconnection.

## 11. Out of scope for v1

Spectator betting; multiple simultaneous live tables; resuming interrupted live games; cross-hand memory / opponent
modelling; equity-hint, sampling and reasoning-mode ablations (config hooks exist, runs deferred); user accounts.

## 12. Assumptions to confirm

- Deployment: one small container host (server + web + SQLite volume), e.g. Fly.io or a VPS. Not yet chosen.
- Exact OpenRouter model ids for the four LLM seats are chosen at run time from what's current and priced then.
- Jev early-access API key available to the author.
- Cost figures in this spec are estimates; published figures are measured.
