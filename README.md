# Clay Island

A hand-molded clay island floats in a soft sky. Six tiny villagers live there. You get Meteor, Lightning, Rain, and Nudge—and a journal of fifteen odd little Moments to discover.

![Meteor anticipation on the clay island](public/gameplay.gif)

## Play locally

```bash
npm install
npm run dev
```

Keyboard play is built in: press `1`, `2`, `3`, or `4` to arm a power, move the reticle with the arrow keys, and press `Enter` to cast. The journal is a focus-trapped dialog with an arrow-key tile grid.

## What makes it tick

- Vanilla Three.js, TypeScript, Vite, and `postprocessing`—no UI framework.
- Villager and prop poses are held at 12 fps while the camera, particles, and post stack stay at display rate.
- A six-minute day/night cycle drives keyframed light, stars, fireflies, and villager sleep schedules, with Auto/Day/Night overrides in Settings.
- The island, clay meshes, textures, particles, foley, and ambient bed are procedural. Runtime gameplay ships no model, texture, font, or audio assets.
- A complete power × target matrix makes every one of the 28 cells explicit and testable.
- Fifteen event-driven Moments persist locally and appear as pressed thumbprints in a focus-trapped DOM clay tablet.
- `prefers-reduced-motion` and `?lowfx=1` retain full keyboard play and the same readable DOM journal.

## Checks

```bash
npm test
npm run lint
npm run build
```
