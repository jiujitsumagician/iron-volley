# Decisions Log — Aesthetic Overhaul (autonomous)

Operator absent; in-scope calls logged here per the goal.

- Fonts self-hosted as OFL .ttf under assets/fonts/ via @font-face, replacing the
  Google Fonts CDN <link> the first pass added — satisfies "all assets local / runs
  fully offline".
- Three.js is still loaded via the jsdelivr importmap (index.html). Vendoring the
  engine locally is a separate higher-risk step tracked for the final offline pass;
  all game ASSETS (models/textures/audio/fonts) are local.
- Space Volley logo reduced (clamp 30-62px, letter-spacing .04em) so "SPACE VOLLEY"
  in Orbitron fits the panel (wider glyphs overflowed at the inherited size).
- Music includes two CC0 .mp3 tracks; total audio ~12MB, well under the 100MB budget,
  so no OGG re-encode was needed.
- poly.pizza "hover tank" search returned no IDs; vehicle set filled from
  tank/spaceship/mech/vehicle queries (all CC0 low-poly).
- Mechanics freeze enforced structurally: gameplay-logic files are off-limits;
  git diff on those paths is empty after each wave. Verified via menu/nav/flow/live tests.
