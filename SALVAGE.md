# artificialBluff — Salvage Report

Rebuild of the TEN "House of TEN" AI-vs-AI poker (on-chain) as an off-chain app.
Salvaged 2026-09-21 from two ZIPs + three local repos.

## What's in `salvage/`

| Folder | Source | Date | Status |
|---|---|---|---|
| `contracts-latest/` | `texas-holdem-main.zip` | Sep 2025 | Newest contracts (per-agent bet limits, claims, 30-min blinds). Game-rule reference only. |
| `agents-latest/` | `ten-projects/LangChain-Agent-for-Poker` (== `texas-holdem/agents`) | Apr 30 2025 | Python LLM agents + timer bot. Prompts salvageable; web3 plumbing not. Secrets stripped, logs redacted. |
| `frontend-latest/` | `ten-projects/ai-poker-ui` | Jun 13 2025 | Next.js 15 spectator UI. Presentational layer highly reusable. |
| `pokerkit-harness-old/` | `poker-agents-main.zip` | Jan 2025 | Scaffold. No LLM code. Only useful as pokerkit usage reference. |

> ⚠️ The public GitHub repo `0xjba/AI-Agents-Poker` (formerly LangChain-Agent-for-Poker) has a committed `.env`
> with 6 private keys + an OpenRouter/redpill API key, and `env.example` has TEN gateway tokens. Rotate/revoke.

---

## 1. Game rules (intended behaviour — port these, not the bugs)

- 2–5 players, seat = index, **10,000** starting chips, blinds start **25/50**, button starts seat 0.
- Blind levels every **30 min** (older builds: 5 min). L→L+1: if `L % 3 == 0` double both, else SB+25/BB+50.
  Sequence: 25/50 → 50/100 → 75/150 → 150/300 → 175/350 → 200/400 → 400/800 → …
- Tournament also ends when SB > avgStack/4 (winner should be chip leader; contract wrongly took first seat).
- Heads-up: button = SB, acts first preflop.
- Short blinds post all-in.
- Actions: `0 FOLD, 1 CHECK, 2 CALL, 3 RAISE`. On-chain RAISE `amount` = **increment over current bet**
  (min = last raise size or BB). Recommend switching to "raise to" semantics off-chain and telling the model explicitly.
- Action timeout **30 s** → auto-fold (better: auto-check when legal).
- Side pots by contribution level; split pots `amount / n`, odd chip should go to first winner left of button.
- Card int encoding 0–51: `rank = c % 13` (0=2 … 12=A), `suit = c / 13` (♥ ♦ ♣ ♠). 0 doubles as "empty" on-chain — use null off-chain.
- Hand types (lower better): 1 Royal, 2 SF, 3 Quads, 4 FH, 5 Flush, 6 Straight, 7 Trips, 8 Two pair, 9 Pair, 10 High.

### Contract bugs NOT to port
Evaluator mis-ranks straights/SF (inverted), flushes, quads/trips/pair kickers · elimination never runs → tournament
never ends / next hand OOGs · timeout double-advances turn · postflop order ignores button · fold double-counts
contribution · betting `potentialPayouts` keyed per bettor not (bettor, player) · `setBetLimits` is a no-op ·
betting never closes · anyone can call most write functions · hole cards readable by anyone.

**Recommendation:** don't port the Solidity engine. Use a proven engine (`pokerkit` in Python, or a TS lib) and a
fresh tournament manager on top.

## 2. Spectator betting (house-banked fixed odds)

- Odds = "percent profit": payout = `amt + amt*odds/100`. Initial 400 (5×), clamp [102, 1000] (2.02×–11×).
- `evenBet = pool / activePlayers`; `odds = clamp(400*evenBet / playerBets)`; no bets on player → 1000 (or 400 if pool 0).
- Bet locks the pre-bet odds; top-ups use weighted-average odds. Limit 5,000 per (user, agent).
- Off-chain: play-money points, no token/wallet.

## 3. Agent prompts (verbatim, `agents-latest/poker_agents/agent.py:85-106, 881-903`)

System:
```
You are an expert poker player making rapid strategic decisions. Analyze the situation and immediately select the SINGLE best action: FOLD (0), CHECK (1), CALL (2), or RAISE (3). If raising, specify the raise amount. Respond **only** with a valid JSON object, no additional text or markdown. Consider:
- Pot odds and implied odds
- Position and table dynamics
- Hand strength and potential
- Stack sizes and tournament stage
- Previous betting patterns
- Tournament vs Cash game strategy

You MUST commit to a single decisive action without ambiguity

Provide concise reasoning (max 100 chars) explaining your decision.

Response format (JSON):
{
    "action": 0-3,
    "amount": raise_amount,  // optional, only if action is 3
    "reasoning": "Brief explanation (100 chars max)",
    "confidence": 0-100
}
```

User (per turn):
```
Game State:
Hand: {hole_cards}
Community Cards: {community_cards}
Current Bet: {current_bet}
Your Current Bet: {player_current_bet}
Amount to Call: {to_call}
Your Stack: {stack}
Your Investment This Hand: {investment}
Pot Size: {pot}
Position: {position}
Active Players: {active_players}
Previous Actions: {previous_actions}
Current Round: {PREFLOP|FLOP|TURN|RIVER}
Tournament Stage: Level {lvl}, Blinds: {sb}/{bb}
```
+ optional `Your actions this hand:\n- {TYPE}: {amount} chips`.

Keep: JSON output, parse → validate → retry → fallback (CHECK else FOLD), 5 s min pacing for spectators,
short-stack auto-shove rules (≤100 chips).
Fix: tell model legal actions + min/max raise explicitly; feed validation error back on retry; real action history
of all players this hand; correct active-player count; reset history per hand; enforce reasoning length; add
per-agent personality (none existed); async LLM calls with timeouts.

Models used: Claude 3.5 Sonnet ×3, GPT-4-1106, Llama-3.3-70B via OpenRouter → later `api.red-pill.ai/v1`.

## 4. Frontend (`frontend-latest/`)

- Next 15.2 / React 19 / Tailwind / shadcn / zustand / framer-motion / howler.
- **Reuse as-is:** Table, Seat (frame, avatar, labels, status, hole cards), PlayingCard, CommunityCards, ChipPile,
  Stake, PlayLog, PlayerBio, EndGameScreen, HelpScreen, Mute/Light toggles, `utils/poker-odds.ts` (equity),
  `getBlindPositions`, `oddsToMultiplier`, `calculatePotentialPayout`, `playSound`, `models/index.model.ts`.
- **Replace:** wagmi/viem wallet, `lib/getGameStates.ts` + poller worker (→ WebSocket/SSE), betting store/contract
  calls, claims page, Neon/Redis API routes, hardhat compile step, TEN branding (logos, og images, copy, GTM).
- UI currently **infers moves by diffing snapshots** (`stores/game.store.ts`). New backend should emit explicit
  events (action + reasoning, street dealt, showdown, pot awarded) → simpler store.
- **Agent reasoning was never shown** (placeholder text in `PlayLogBasicItem.tsx:110-123`). Wire it up — headline feature.
- Replay mode: `NEXT_PUBLIC_SHOW_TEST_CONTROLS=true` + `public/testIterations/*.json`.
- Personas (`lib/constants.ts`) parody real people (SBF, Do Kwon, …) — likeness risk; rethink.
- Frontend data contract (snapshot shapes): see `frontend-latest/src/models/index.model.ts`
  (`ContractGameState`, `ContractTournamentState`, `ContractPlayerState`, `PlayerActionEvent`, `AiPlayer`).

## 5. Proposed off-chain architecture (draft — pending Jev details)

```
 ┌──────────────┐   decide(state) → action   ┌─────────────────────────┐
 │ Game server  │ ─────────────────────────▶ │ Player adapters         │
 │ engine +     │ ◀───────────────────────── │  • LLM (OpenRouter etc) │
 │ tournament + │                            │  • Jev                  │
 │ timers       │                            └─────────────────────────┘
 │ + event log  │ ── WS/SSE events ──▶ Next.js spectator UI (salvaged components)
 └──────────────┘ ── persist ──▶ SQLite/Postgres (hands, actions, reasoning)
```
- One process owns the game; players are pluggable adapters behind one interface
  (`decide(observation) -> {action, amount, reasoning}`), each only seeing its own hole cards.
- Event-sourced hand log → live stream, replays, and the spectator UI.

## Open questions
1. What is Jev (model / agent / API), and how is it called?
2. Language for the server: Python (pokerkit, reuse agent code) or TypeScript (one language with the UI)?
3. Keep spectator betting (play money) or drop it for v1?
4. New brand/personas to replace "House of TEN"?
