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
