# artificialBluff

Off-chain rebuild of "House of TEN" (AI-vs-AI Texas Hold'em) as a research benchmark of TypeSafe's Jev vs LLMs,
plus a live spectator game.

## Read first

- `docs/STATUS.md`: current progress, plan/task checklist, todos, open questions. **Keep it updated** after
  every completed task or decision.
- `docs/superpowers/specs/2026-09-21-artificialbluff-design.md`: approved design (authoritative).
- `docs/superpowers/plans/`: implementation plans, executed task by task (subagent-driven).
- `SALVAGE.md`: what was recovered from the old on-chain project and why Solidity is reference-only.
- `docs/jev/`: TypeSafe/Jev API docs.

## Conventions

- pnpm workspaces, TypeScript strict, Vitest. Run `pnpm test && pnpm typecheck` before calling anything done.
- TDD: failing test first. Commit per task.
- Commit identity: `git -c user.email=jobinb6444@gmail.com -c user.name=0xjba commit ...`
- Secrets only in `.env` (git-ignored). Never copy anything from the old `AI-Agents-Poker` repo's `.env`.
- `salvage/` is git-ignored reference material; never import from it.
- `pnpm demo` plays a free mock tournament into `data/demo.db`. `pnpm smoke lineups/live.json` spends real money (OpenRouter + TypeSafe): never run it without the user's explicit go-ahead. Line-ups: `lineups/*.example.json`; keys in `.env` (see `.env.example`).
- `pnpm live --mock` (free live server on :8787; admin API with `ADMIN_TOKEN`) and `pnpm web` (site on :3000). Real live games (`pnpm live` without `--mock`) spend money once an admin starts one: never without the user's go-ahead.
- `pnpm study report <study.json> [--mock]` writes `reports/<id>/report.html` plus JSON/CSV exports from the event log (free).
- `pnpm study run <study.json> --mock` is a free rehearsal; `--live` spends real money (up to the study's budget): never run `--live` without the user's explicit go-ahead.
