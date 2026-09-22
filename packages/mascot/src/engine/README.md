# Vendored: bloub engine

The files in this folder come from **bloub** by Jérémy Perret (MIT, see `../../LICENSE-bloub`):
https://github.com/jeremy-prt/bloub, `src/bot/`, commit `b4bb3c1`. Comments are the upstream French.

Only the clock-free engine is vendored (no Vue, no DOM): `math`, `profiles`, `shape`, `skins`, `face`,
`expressions`, `states`, `eyefit`, `decor`, `engine`, `repere`, with their upstream tests.

artificialBluff changes (each marked `artificialBluff:` in the code):

- `decor.ts`: rings and ribbons are neutral white (saturation 0, lightness 0.9) instead of a hue wheel.
- `engine.ts`: every player keeps its chosen body shape through every animation. `orbit` spins the
  player's shape instead of a triangle; states that draw the body as a circle draw the player's shape
  at that size; glyph states (the "!" bars) and shape states (egg, hexagon, play) are unchanged.
- `engine.test.ts`, `skins.test.ts`: the two upstream tests that pinned "a chosen shape never reaches
  the animated states" are narrowed to glyph and shape states, and new tests pin the new rule. In
  circle-drawn states an eye can be clipped at the edge of some shapes (e.g. the capsule in `burst`),
  as upstream `orbit` already does with a circle; the mask handles it, and it is accepted.
- Rings use lightness 0.8 (a light grey-white) so they stay visible across the white bodies.

Keep the rest byte-for-byte upstream so future fixes can be merged.
