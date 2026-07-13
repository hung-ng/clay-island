# Architecture

## Current structure

- `src/main.ts` is the browser composition root. It creates the scene bundle, island, and world registry; scatters the initial settlement; spawns six villagers; registers the floating island; runs villager behavior and population checks on the fixed simulation step; and advances the shared 12fps visual clock alongside display-rate composer rendering before dismissing the splash after the first frame.
- `src/scene.ts` owns renderer creation and WebGL fallback, golden-hour lighting and VSM shadows, the post-processing composer, the responsive perspective camera and constrained orbit controls, the procedural gradient sky, six cloud clusters, reduced-motion-aware ambient movement, and the eight-second auto-rotate pause after camera interaction.
- `src/core/motion.ts` exposes a live reduced-motion media-query check without importing Three.js.
- `src/core/rng.ts` provides the seedable pseudo-random source used for reproducible simulation and procedural generation.
- `src/core/noise.ts` builds deterministic 2D value noise and fractal Brownian motion from integer lattice hashing.
- `src/core/events.ts` defines the shared game-event contract and a synchronous subscription bus that safely tolerates unsubscription during dispatch.
- `src/core/loop.ts` separates fixed-step simulation from display-rate rendering and provides the 12fps quantized animation clock.
- `src/core/timeline.ts` schedules one-shot callbacks for the staged anticipation, impact, and aftermath beats used by powers.
- `src/fx/clayMaterial.ts` creates the shared toon material, including a cached soft three-band ramp and shader patches for fingerprint-scale normal breakup and hand-mixed color variation. Flat variants skip shader noise and use a distinct program-cache key.
- `src/fx/wobble.ts` mutates a geometry once by displacing vertices along their normals with seeded, decorrelated low-frequency noise, then rebuilds its normals.
- `src/fx/emotes.ts` owns one canvas-generated six-cell glyph atlas and the billboarded `EmoteSprite`. Each sprite selects an atlas cell and applies its pop, bob, and lifetime only on quantized frames.
- `src/world/craters.ts` is the pure crater geometry contract: it calculates accumulated bowl depth and resolves whether a point lies inside a crater rim.
- `src/world/island.ts` owns the procedural radial-grid grass surface, dirt fringe, rocky lathed underside, and the crater-aware ground-height query used by all future grounded entities.
- `src/world/scatter.ts` is the pure deterministic layout solver. It rejection-samples every new footprint against all earlier placements so trees, huts, the build site, and the central campfire cannot overlap.
- `src/world/objects.ts` defines the visual `Tree`, `Hut`, and `Campfire` entities from wobbled clay primitives. It owns their state-driven crown/build/fire behavior, 12fps smoke and flame motion, instanced stones and fruit, normal shadow casting, and low-FX blob-shadow fallbacks.
- `src/world/world.ts` owns the small world registry and its linear spatial queries, target resolution order, shared event bus, villager alarms, delayed hut-based repopulation, and the visual scatter bridge that turns pure placements into crater-aware grounded entities.
- `src/villagers/fsm.ts` is the pure theatrical behavior selector. It fixes the villager state union at exactly eight states, applies danger/mourning/rebuilding overrides in priority order, filters idle activities by world availability, and supplies deterministic per-state duration ranges.
- `src/villagers/villager.ts` owns the wobbled pill-bodied villager mesh, deterministic spawning, continuous steering, activity execution, quantized transforms and poses, emote delegation, death records, and four-frame hut respawn entrance.
- `src/ui/tokens.ts` is the design-token source of truth for the game palette, typography, and timing. Visual modules consume the exported string and numeric constants; the module remains independent of Three.js.
- `src/styles.css` defines the global document, canvas, overlay, splash, focus, and reduced-motion rules. Its small CSS custom-property set mirrors the matching values from `src/ui/tokens.ts` as required by the implementation plan.
- `index.html` owns the permanent `#app` canvas mount, `#ui` overlay root, loading splash, and no-JavaScript fallback.

## Key patterns

- Visual colors are named semantically in `PALETTE` rather than invented inside feature modules.
- Model animation uses the shared 12fps value in `TIMING`; UI transitions remain smooth and use separate durations.
- The full-screen `#ui` layer ignores pointer input by default, while its direct children opt back in.
- Reduced-motion users receive effectively instant CSS animations and transitions.
- Browser globals stay at the visual composition boundary; pure modules remain safe to exercise in Vitest's Node environment.
- Core simulation modules do not import Three.js. Seeded randomness, noise, event delivery, quantized time, and staged timelines are deterministic or directly unit-testable.
- Visual geometry is made irregular once at construction time, while the clay material supplies reusable surface character at render time. Both effects are procedural and require no asset files.
- `Island.sampleHeight()` is the single terrain-height authority. It combines the undeformed procedural surface with all active crater offsets so walkers and props cannot diverge from visible terrain deformation.
- Ambient camera, island, and cloud motion consult the live reduced-motion preference; direct camera input remains enabled.
- Normal rendering caps DPR at 1.25 and uses one 2048px VSM shadow map plus tilt-shift, vignette, 12fps-held grain, and a subtle saturation grade. `?lowfx=1` fixes DPR at 1, disables the shadow map, and retains only the composer render pass.
- Film grain owns an explicit seed uniform rather than using `postprocessing`'s display-rate time uniform. It advances only on the shared 12fps cadence and becomes lower-opacity static grain under reduced motion.
- Repeated small object details use `InstancedMesh`, while stateful trees and huts remain independent object groups. In low-FX mode their child meshes stop casting map shadows and each grounded object receives one transparent blob-shadow disc.
- Spatial target resolution is intentionally ordered and linear: villagers, trees, huts, campfire, ponds, craters, then ground. The registry remains small enough that a spatial index would add complexity without practical benefit.
- Villager decisions use hard narrative triggers before a weighted idle roll: nearby fire overrides every activity, then fresh graves and ruins; only currently available idle actions enter the seeded random selection. This keeps behavior legible without needs, utility scoring, or planning.
- Villager coordinates and timers advance on the fixed 30Hz simulation step, but model positions, facing, waddles, work poses, spawn scale, and emote animation are written only when the 12fps clock changes. This intentional one-frame visual lag is the claymation effect.
- Villager movement uses direct steering plus short-range repulsion from registered solid objects and a hard `WALK_RADIUS` clamp. There is intentionally no navmesh or pathfinding.
- Population is self-healing: once fewer than six villagers remain and a built hut exists, `World.repopulate()` waits a seeded 20–30 seconds before spawning one replacement from the hut. Dead entries remain in the registry for later grave/discovery history while living-count checks ignore them.

## Classes and database schema

The project-defined classes are `RNG`, `EventBus`, `GameLoop`, `QuantizedClock`, `Timeline`, `Island`, `Tree`, `Hut`, `Campfire`, `World`, `EmoteSprite`, `Villager`, and the scene-private `HeldNoiseEffect`. `World` stores typed tree, hut, and villager arrays, one campfire, and placeholder `unknown[]` registries for graves and ponds until their later tasks define those classes. Villager deaths currently append the minimal `{ x, z, fresh }` grave record that Task 15 will replace with its visual `Grave` class. There is no persistent storage or database schema. The scene and composition roots also instantiate Three.js renderer, scene, camera, control, light, geometry, mesh, sprite, instanced-mesh, material, texture, composer, pass, effect, and object-group classes.
