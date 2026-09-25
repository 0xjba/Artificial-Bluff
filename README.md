# Artificial Bluff

**AI models play No-Limit Texas Hold’em against each other: a live spectator site, and a pre-registered
research benchmark of a small, fast decision model against frontier language models.**

Five AI players sit at one table. Nobody human is in the hand. Spectators see every card and each model’s
stated chance of winning, set against the true chance computed from all the cards. Behind the site is a
research pipeline that runs controlled studies, analyses them statistically and writes up the results as a
technical paper.

The question the research asks: *can a small, fast typed-readout model (TypeSafe’s Jev), used as intended,
judge its chances and make its decisions as well as frontier language models (Claude, GPT, Gemini, Llama),
at a fraction of their time and cost?*

## Highlights

- **A complete poker engine** in TypeScript: No-Limit Hold’em rules, side pots, and a priced menu of legal
  actions, so no model ever writes a number and every move is legal by construction.
- **Two kinds of AI player** behind one interface: language models through OpenRouter (structured JSON
  output, strict validation, failure accounting) and TypeSafe’s Jev through its typed Choice/Noul API.
- **A research pipeline** built for fair comparison: duplicate seating (every deal played from every seat
  by every model), a pre-registration record hashed before the first hand, a pre-set stopping rule, and a
  budget cap on real API spend.
- **Statistics a reviewer would expect**: win chances scored against exact equity (full enumeration of the
  remaining board) with Brier scores, calibration error and a skill score; intervals from a bootstrap over
  seating blocks; paired comparisons with Holm’s correction; and comparisons on *identical spots*, the
  decisions that duplicate seating makes the same for every model, which remove the bias of which hands each
  model chose to play.
- **An automatically written paper**: each study produces a technical report (abstract, method, results with
  figures and tables, discussion, limitations, references) as HTML and PDF, with every claim conditional on
  the data, plus the full decision-level data as CSV, JSON and an event log.
- **A live spectator site** in Next.js: a streamed table (Server-Sent Events), replays with a seek bar,
  animated dealing, a hand log, per-model statistics, a Research page with an in-page PDF reader, and a
  “Run a table” page where visitors play models with their own API keys in the browser.
- **Production deployment**: Docker Compose with Caddy (HTTPS on a VPS) or a Cloudflare Tunnel (a home
  server with no open ports).

## Results so far

All studies are pre-registered and their data published; numbers below are from the generated reports.

| Study | Hands | Cost | What it found |
|---|---|---|---|
| Main (Jev vs Claude Fable 5.1, GPT-6 Astra, Gemini 3.8 Flash, Llama 4 Maverick) | 600 | $25 | Jev was 2.3× faster than the fastest language model and 3.7× cheaper than the cheapest (400× cheaper than the most expensive), but last on the pre-registered calibration measure. A post-processing rule of ours distorted its moves, and was dropped. |
| Follow-up (Jev asked in two steps, with hand facts, vs Gemini and Llama) | 2,000 | $3.45 | Jev won the most chips (+196 bb/100) and beat Gemini (p = 0.027) and Llama (p < 0.001) after Holm’s correction, at a table where Llama’s losses funded the winners. On identical spots its win estimates were closer to the truth than both models’, but its decisions trailed Gemini’s. |
| Final (Jev vs the full frontier line-up, fixed 1,000 hands) | 1,000 | ~$44 | Rehearsed and pre-registered; primary outcomes are the identical-spot comparisons. |

The two finished studies point to the same finding: **Jev knows the odds about as well as the language models,
but acts on them less well**, and it does so at a small fraction of the time and cost.

## Architecture

```
packages/
  engine     No-Limit Hold'em rules, pots, action menu, exact equity, hand facts, duplicate schedules
  players    Player interface; OpenRouter LLM player, TypeSafe Jev player, bots, offline stand-ins
  core       Hand runner, timeouts and fallbacks, event log (SQLite), table view for spectators
  analysis   Hand reconstruction, decision scoring, calibration, play-style metrics
  mascot     The five seat characters and their animation cues
apps/
  server     Live server: plays games, streams them (SSE), serves replays, admin API
  study      Study runner and CLI: pre-registration, stopping rule, statistics, report and paper
  web        Next.js site: live table, replays, models, research, in-browser tables
```

Every game is an append-only event log (who was dealt what, every decision with its stated probabilities,
timing, tokens, cost and serving host), so every figure in a report can be recomputed from the log.

## Tech

TypeScript (strict) · Node.js · pnpm workspaces · Next.js 16 and React 19 · SQLite (better-sqlite3) ·
Server-Sent Events · OpenRouter · TypeSafe SDK · pdf.js · Vitest (550+ tests, test-first) · Docker Compose ·
Caddy · Cloudflare Tunnel · headless Chrome for PDF output.

## Running it

Requires Node.js 20.12+ and pnpm.

```bash
pnpm install
pnpm test && pnpm typecheck
```

Free, no API keys needed:

```bash
pnpm live --mock          # live table with mock players on :8787
pnpm web                  # the site on :3000
pnpm demo                 # a mock tournament into data/demo.db
pnpm study run studies/final.example.json --mock      # rehearse a study
pnpm study report studies/final.example.json --mock   # its report and paper
```

Real models need `OPENROUTER_API_KEY` and `TYPESAFE_API_KEY` in `.env` (see `.env.example`) and spend real
money: `pnpm study run <study.json> --live` runs up to the study’s budget cap. Deployment guides:
`docs/deploy.md` (VPS) and `docs/deploy-home.md` (home server).

## Resume summary

**Artificial Bluff: AI-vs-AI poker platform and research benchmark** (TypeScript, Next.js, SQLite, Docker)

- Built a full No-Limit Texas Hold’em engine and a live spectator site where frontier language models
  (Claude, GPT, Gemini, Llama) and TypeSafe’s Jev play each other, streamed in real time with replays.
- Designed a pre-registered evaluation protocol (duplicate seating, exact-equity scoring, identical-spot
  comparisons, cluster-bootstrap intervals, Holm-corrected paired tests) and a pipeline that turns each study
  into a technical paper with figures, tables and published data.
- Ran pre-registered studies on real APIs within budget caps ($25 and $3.45; a final ~$44 study is set up);
  found the small model 2–6× faster and 3.5–400× cheaper than frontier models, with win estimates as
  accurate as theirs but weaker decisions.
- Shipped with 550+ tests (test-first) and Docker deployment behind Caddy or a Cloudflare Tunnel.

## Credits

Built by Jobin Ayathil. A rebuild, off-chain, of the earlier on-chain “House of TEN” AI poker game (see
`SALVAGE.md`); third-party notices in `LICENSE-THIRD-PARTY`.
