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

## Wave 4 (tank models)
- The shared GLB hull is RETIRED. `tank_static.glb` was being fitted to all ten
  tracked chassis, so JACKAL and GOLIATH — a 9.4-unit scout and a 13.2-unit
  superheavy — wore the identical rounded lozenge, and `plated` / `lowProfile` /
  `wheels` had no visible effect at all. Worse, the GLB branch skipped the
  procedural track code entirely, so tracked tanks rendered with NO visible
  tracks, road wheels or sprockets. Everything is procedural again, but built
  per-chassis from the build flags, which is what "each chassis reads instantly
  at a distance" asked for in the first place.
- New `src/tankart.js` holds all tank visuals (materials, generated textures,
  hull/running-gear/turret/gun builders). tank.js keeps the entity + the frozen
  rig and just composes them, so the mechanics audit has one file to read.
- Real running gear: the track belt is generated geometry — the convex hull of
  the front idler and rear drive sprocket (two arcs joined by their external
  tangents), with arc-length UVs so the tread scrolls correctly around the
  curves rather than sliding sideways. Road wheels come from `b.wheels`, plus
  sprocket teeth, idler, return rollers and a fender.
- Armour is textured from a generated height field Sobel'd into a normal map:
  panel seams, weld beads, rivet lines, scuffs, plus a matching roughness map.
  Deterministic (fixed LCG seed) so the plate is identical every boot.
- Painted armour is a DIELECTRIC — metalness 0.08, not the 0.5 the first pass
  used, which made every tank look like polished brass under the wave-3 sky IBL.
  Gun tube and track links keep their metalness.
- Tanks now RECEIVE shadows, not just cast them. Wave 3 fitted the sun's shadow
  box tightly to the action; with receiveShadow off, tanks were the one thing in
  the scene that couldn't benefit from it.
- Draw calls held roughly flat despite ~40 new greebles per tank: static detail
  is accumulated per material and merged once via BufferGeometryUtils. Only the
  road wheels and belts stay separate, because they animate. mergeGeometries
  rejects a batch that mixes indexed and non-indexed geometry — and this one
  always does, since ExtrudeGeometry is non-indexed and Box/Cylinder are not —
  so everything is flattened to non-indexed first.
- Wheel spin + belt scroll moved from `update()` into `poseMesh()`. The online
  guest never runs update(), so its tanks used to slide around on dead tracks.
- `disposeMaterial()` frees every texture slot, not just `.map`. Callers only
  disposed `.map`, which was fine when that was all a tank material carried;
  armour now brings a per-tank normal + roughness clone, so a match teardown was
  leaking a dozen GPU textures. envMap is excluded — that slot is the shared
  per-map PMREM probe.
- Two geometry bugs found and fixed by inspection, both invisible in the
  SwiftShader harness: `rotateY(+PI/2)` on the extruded hull mirrors it
  front-to-back AND leaves it a full hull-width off centre (it must be
  `-PI/2`); and the glacis was a separate full-width plate bolted onto a face it
  already matched, which read as a fin floating off every tank's nose — the nose
  break is now part of the hull profile.
- Judged on a real GPU via a new `test/gallery.mjs` bench (contact sheet of all
  twelve chassis, plus single-chassis views), for the same reason wave 3 gave:
  SwiftShader is too coarse to show material or geometry detail.
- Mechanics: every gameplay-logic file byte-clean; the rig offsets
  (turret/barrel/muzzle/mgMuzzle/tubeOffsets) are byte-identical to the previous
  commit, so shells still spawn exactly where they did. Full playtest PASSED.
