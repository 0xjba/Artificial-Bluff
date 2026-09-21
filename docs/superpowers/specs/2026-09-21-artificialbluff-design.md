# artificialBluff — Design Spec

Date: 2026-09-21 · Status: awaiting user review

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
| Line-up | Jev + 2 frontier LLMs + 1 small/fast LLM + 1 open-weight LLM (5-max), all configurable |
| LLM access | OpenRouter |
| Action space | One shared menu of realistic sizes, shown as chip amounts |
| Calibration | Every player states win probability + confidence per decision; per-player curves on site, per-action analysis in report |
| Study budget | Free mock run → ~$1 smoke (~100 hands) → main run with CI-based stop, hard cap ~$25 |
| Live games | On demand, turbo structure, ~$0.50/game estimate, per-game cap; replays when idle |
| Spectator betting | Not in v1 |
| Brand | "artificialBluff", Broadcast direction (felt green, brass, Barlow) |
| Mascots | bloub engine (MIT), neutral white, distinct shape per player, shape kept through all animations |
| Names | Persistent character + always-visible model badge (JEV, PILL, BLOCK, DRIP, NIMBUS) |

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

**Event log is the single source of truth.** Events: `HandStarted`, `CardsDealt`, `TurnStarted`, `Decision`,
`StreetDealt`, `Showdown`, `PotAwarded`, `HandEnded`, `GameEnded` (plus `GameInterrupted`, `BudgetCapReached`).
A `Decision` records: seat, player id, model + version, legal options, chosen option, per-option probabilities
(Jev), win probability, confidence, reasoning (LLMs), latency ms, input/output tokens, cost USD, fallback flag,
retry count. Live view, replays and research all read this log. Seed + decisions reproduce a hand exactly.

**Storage:** SQLite (single file). Secrets (`OPENROUTER_API_KEY`, `TYPESAFE_API_KEY`, `ADMIN_TOKEN`) only in `.env`,
git-ignored from the first commit.

## 4. Game engine and formats

**Rules:** standard No-Limit Hold'em, implemented correctly (not ported from Solidity):
- 5 seats; button rotates; correct heads-up rules (button posts SB, acts first preflop).
- Standard min-raise rule; an incomplete all-in raise does not reopen action for players who already acted.
- Side pots by contribution level; odd chip to first winner left of the button.
- Hand evaluation via a proven evaluator library, cross-checked by a brute-force reference in tests.
- Seeded Fisher–Yates shuffle; cards as `{rank, suit}` objects (no "0 = empty" sentinel).
- Timeout: check if legal, else fold. Live turn limit 30 s; per LLM call timeout ~20 s.

**Action menu** (identical for all players; only legal options offered; options collapsing to the same amount
merged; amounts rounded to a 25-chip unit):
- Preflop: min-raise, open to 2.5 / 3 / 4 bb, 3-bet to 3× the last raise, all-in.
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

**Duplicate:** each deck seed is played 5 times, cyclically rotating players through all seats. The seed group is the
statistical unit. Results in bb/100 with 95% bootstrap CIs over seed groups.

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
  choice confidence, win probability.

**LLM adapter** (OpenRouter):
- Cached system prompt: rules summary, option semantics, output schema. Baseline wording derived from the salvaged
  prompt (`SALVAGE.md` §3), fixing its known defects.
- Output: `{"action":"<option id>","win_probability":0-1,"confidence":0-1,"reasoning":"≤120 chars"}`; JSON-schema
  mode where supported; temperature 0.3; reasoning/thinking disabled; max ~150 output tokens.
- Invalid output → one retry including the specific error → fallback check/fold flagged `fallback:true`.

**Bots:** Random, CallingStation, simple rule-based TAG, MockLLM (deterministic, free) for tests and $0 runs.

**Measured per call:** wall-clock latency; LLM cost from OpenRouter-reported usage/cost; Jev cost from tokens ×
published price; model version.

## 6. Study runner and results

`pnpm study run study.config.ts`. Config: line-up, observation flags, master seed, target CI half-width, budget
cap, concurrency, minimum seed groups.

- **Pre-registration:** config + hash written to the log before hand 1; report quotes the hash.
- **Budget:** running cost; stop launching groups when the next could exceed the cap; in-flight groups finish;
  incomplete groups excluded.
- **Resume:** re-running skips completed (seed, rotation) pairs.
- **Stopping:** every 20 groups, compute 95% bootstrap CIs of bb/100; stop when all half-widths ≤ target (not
  before the minimum), or at the cap.
- **Stages:** `--players mock` ($0) → smoke ~100 hands (~$1) → main (cap ~$25).

**Outputs:** static HTML report, CSV/JSON of every decision, and the same charts on the site's `/research` page:
results (bb/100 ± CI), cost ($/decision, $/100 hands), latency (p50/p95), win-probability calibration (reliability
curves, Brier, ECE), per-action calibration (confidence vs realised profitability; folds scored by all-in equity at
decision time), invalid/fallback rate, play style (VPIP, PFR, aggression, showdown %).

## 7. Live server, replays, site

**Server states:** `idle → live → ended → idle`; one live table in v1.
- `POST /games` with `ADMIN_TOKEN` starts a live game (hidden admin button or curl).
- Idle: replays through the same event stream, labelled "REPLAY": past live games + an auto-picked highlight reel of
  study hands (biggest pots, all-ins, largest Jev-vs-LLM win-probability disagreements).
- Per-game cost cap: game ends after the current hand; chip leader wins; UI shows "budget cap reached".
- WebSocket: snapshot on connect (current state + recent events), then deltas. Spectators see all hole cards;
  players only their own.

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

## 8. Brand

- **Direction C, Broadcast.** Felt `#0B2A24`, panel `#0E3029` / `#123A32`, rule `#1F4A40`, cream text `#F3EBDD`,
  muted `#9DB8AE`, brass accent `#E8B04A`, alert red `#D9534F`. Type: Barlow Condensed (display), Barlow (body).
- **Mascots:** vendored bloub engine (MIT, credited in `/about` and `LICENSE-THIRD-PARTY`). All bodies neutral
  white `#F5F3EE`; decorative rings/comet trails white (no rainbow). Distinct shapes: JEV hexagon, PILL capsule,
  BLOCK squircle, DRIP droplet, NIMBUS cloud. Engine change: narrative states (orbit, etc.) keep the player's own
  body shape. No circle and no black body, to stay clear of the xAI bot identity.
- **Mascot state mapping:** waiting → idle; deciding → thinking; Jev decides → comet; check/call → attentive;
  raise → excited; all-in → exclaim then burst; fold → unimpressed; win pot → laughing then orbit; big loss → sad;
  eliminated → sleep; timeout/fallback → confused.
- **Names:** character + model badge on every seat; research pages use model names. Badges from config.
- Preview renders: `docs/brand/mascots-v2-mono.png`.

## 9. Error handling

| Failure | Behaviour |
|---|---|
| LLM timeout / error / invalid output | One retry with the error, then check/fold `fallback:true`; counted and displayed |
| Jev API error / 429 | SDK backoff retries, then the same fallback |
| Provider outage in live game | After 3 consecutive fallbacks, seat auto check/folds for the rest of the hand; UI shows "connection lost" |
| Server crash, live | Game marked interrupted on restart; replay remains; no live resume in v1 |
| Server crash, study | Resume skips completed pairs; partial groups dropped and replayed |
| Budget cap | Study: no new groups. Live: end after current hand. Both logged |
| Illegal engine operation | Throw (programming bug); unreachable through the menu |

## 10. Testing

- Engine unit tests for every rule in §4, plus regression tests for each salvaged contract bug.
- Property tests: thousands of random bot hands asserting chip conservation, card uniqueness, pot sums, termination.
- Evaluator cross-check against brute force on a large random sample.
- Determinism: same seed + decisions → identical event stream.
- Player adapters against recorded/mock responses (valid, malformed JSON, illegal option, timeout); Jev via mocked
  SDK. Real API calls only in the smoke run.
- Statistics validated on synthetic data with known answers (e.g. perfectly calibrated fake player).
- Web: component tests for decision panel and scoreboard; one end-to-end test replaying a recorded game through the
  WebSocket to the browser.

## 11. Out of scope for v1

Spectator betting; multiple simultaneous live tables; resuming interrupted live games; cross-hand memory / opponent
modelling; equity-hint, sampling and reasoning-mode ablations (config hooks exist, runs deferred); user accounts.

## 12. Assumptions to confirm

- Deployment: one small container host (server + web + SQLite volume), e.g. Fly.io or a VPS. Not yet chosen.
- Exact OpenRouter model ids for the four LLM seats are chosen at run time from what's current and priced then.
- Jev early-access API key available to the author.
- Cost figures in this spec are estimates; published figures are measured.
