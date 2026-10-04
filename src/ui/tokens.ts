// The ONLY place hex values live. Three.js consumes these strings directly;
// styles.css mirrors them as custom properties (keep the two in sync by hand —
// there are ~12 of them and a build step would be more machinery than it saves).
export const PALETTE = {
  // island
  grassLight: '#a7c957',
  grassDark: '#7fb069',
  dirt: '#9c6644',
  rock: '#7f5539',
  soil: '#6b4630', // the dark band right under the grass
  strataLight: '#b98256',
  strataDark: '#5e3f2e',
  lipShadow: '#4f7a45', // underside of the rolled grass lip
  grassDeep: '#6a9a50',
  grassSun: '#bcd567',
  scorch: '#3d3436',
  // objects
  bark: '#8a5a44',
  leafA: '#6a994e',
  leafB: '#588157',
  hutClay: '#d4a373',
  stone: '#8d8078',
  fish: '#d98452', // salmon; reads as a fish against the blue water
  // life & fire
  skin: '#e8b087',
  smockA: '#c96f4a', // terracotta
  smockB: '#6d9dc5',
  smockC: '#e0c341',
  flame: '#ff8c42',
  ember: '#ffd166',
  lamp: '#ffb05c', // hut doorways after dark
  water: '#6d9dc5',
  rainDrop: '#d6ecfa',
  rainCloud: '#c4ccd6',
  bloom: '#e56b9f',
  wildflower: '#b9a3e3', // lilac; pink stays reserved for First Bloom
  ghost: '#e8ecf1',
  cloud: '#fffaf2', // clay white — never pure #fff; nothing in clay is pure white
  // sky & light
  skyLow: '#ffd9a0',
  skyHigh: '#aee1f5',
  keyLight: '#ffe3c0',
  fillSky: '#bcd7ff',
  fillGround: '#e8b087',
  // day/night cycle
  dawnSkyHigh: '#8fb8d8',
  dawnSkyLow: '#ffb499',
  dawnKeyLight: '#ffc9a3',
  daySkyHigh: '#9edcf7',
  daySkyLow: '#d9f0fa',
  dayKeyLight: '#fff3dc',
  duskSkyHigh: '#7b6f9e',
  duskSkyLow: '#ff9b6b',
  duskKeyLight: '#ffb37e',
  nightSkyHigh: '#141e33',
  nightSkyLow: '#34426c',
  nightKeyLight: '#a8c0e8',
  nightFillSky: '#31406b',
  nightFillGround: '#232633',
  nightCloud: '#76829f', // moonlit, so the low deck never reads as holes in the sky
  // ui
  paper: '#e8d5b7', // clay-cream, the tray + journal surface
  ink: '#3d3436',
  inkSoft: '#6f645f',
  toonShadow: '#555555',
  toonMid: '#999999',
  unmodulated: '#ffffff',
} as const

export const TYPE = {
  ui: "system-ui, -apple-system, 'Segoe UI', sans-serif",
  display: "'Archivo Black', 'Helvetica Neue', Impact, sans-serif", // system-resident fallbacks; no web font shipped
  uiSize: '13px',
  uiTrack: '0.08em',
} as const

// Stop-motion is 12fps; UI transitions are NOT — the UI is real-world objects,
// they move smoothly. Only the model stutters.
export const TIMING = {
  fps: 12,
  uiFast: 140,
  uiSlow: 320,
} as const
