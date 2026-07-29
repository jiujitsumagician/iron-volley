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

## Wave 3 (render quality)
- EffectComposer's default render target carries no `samples`, so solo mode — the only
  mode that goes through the composer — was rendering with NO antialiasing despite
  `antialias: true` on the renderer. Fixed with an explicit multisampled HalfFloat target
  (`samples: 4`, matching what the direct split-screen path already got).
- Lighting probe switched from RoomEnvironment (an indoor studio box) to a PMREM baked
  from each map's OWN sky dome, cached per map id. Armor now reflects the sky it sits under.
  Physically honest, but cinder/neon skies are ~11x dimmer than dunes and turned tanks into
  black silhouettes — so `skyEnvIntensity()` partially normalizes on sky luminance
  (power curve, clamped 0.45-3.0): dark maps stay visibly dark and keep their colour cast
  while staying readable.
- Shadows: the fixed 840-unit ortho box at 2048 gave ~0.41 world-units/texel against an
  ~8-unit tank. Now fitted per frame to the action (both split-screen seats) and snapped to
  light-space texels to stop crawl — typically ~0.125 units/texel, ~3.3x sharper for free.
  Kept 2048, not 4096: the fit already bought the sharpness. The online guest returns early
  from update(), so it needed its own updateShadows() call — harmless under the old huge
  box, black screen under a fitted one.
- Grass was `alphaTest: 0.0` with no alpha map, i.e. solid untextured rectangles — the
  worst artifact in the game. Now alpha-cut blades with a vertex-shader wind bend.
  Count 2600 -> 4800 (9000 was too heavy). Safe for determinism: grass draws from its own
  RNG stream and has no colliders.
- Perf judged on a real GPU (--use-angle=d3d11), NOT the SwiftShader test harness.
  SwiftShader rasterizes MSAA/aniso/shadows on the CPU and grossly overstates their cost;
  it called these changes a 2x regression where real hardware shows none. The harness got a
  raised Playwright timeout rather than having the features tuned down to suit it.
- Mechanics: gameplay-logic files untouched; full headless playtest PASSED (26/26).
