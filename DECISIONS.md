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

## Wave 2 (3D models / textures / offline engine)
- three.js + GLTFLoader + used addons + PeerJS vendored locally; importmap -> local paths;
  index.html has ZERO http(s) refs -> fully offline.
- Tank: GLB Quaternius hull as the visible chassis with the procedural
  turret/barrel/muzzle/mgMuzzle rig kept on top (rig-preserving) so aiming/firing are
  behaviour-identical; hover chassis stay procedural; fail-safe procedural fallback.
- Props: GLB models fitted to the EXISTING collider radius; obstacles.push collider
  entries unchanged; model variant derived from the already-rolled RNG value so the
  seeded stream (prop positions/scale/collider radius) is byte-identical.
- Terrain ground color+normal textures per map (fail-safe -> procedural detail on 404).
- Particle polish (muzzle embers / dust) via existing effect hooks (cosmetic only).
- Codex senior review run on the wave-2 diffs; its mechanics-drift blocker (Space Volley
  propModel drew a stray rng()) and the texture fail-safe gaps were fixed before commit.
- Mechanics: gameplay-logic files byte-clean; tank.js/terrain.js changes confined to
  visual builders; full headless playtest PASSED on both games.
