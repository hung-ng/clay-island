// The ONLY place hex values live. Three.js consumes these strings directly;
// styles.css mirrors them as custom properties (keep the two in sync by hand —
// there are ~12 of them and a build step would be more machinery than it saves).
export const PALETTE = {
  // island
  grassLight: '#a7c957',
  grassDark: '#7fb069',
  dirt: '#9c6644',
  rock: '#7f5539',
  scorch: '#3d3436',
  // objects
  bark: '#8a5a44',
  leafA: '#6a994e',
  leafB: '#588157',
  hutClay: '#d4a373',
  stone: '#8d8078',
  // life & fire
  skin: '#e8b087',
  smockA: '#c96f4a', // terracotta
  smockB: '#6d9dc5',
  smockC: '#e0c341',
  flame: '#ff8c42',
  ember: '#ffd166',
  water: '#6d9dc5',
  bloom: '#e56b9f',
  ghost: '#e8ecf1',
  cloud: '#fffaf2', // clay white — never pure #fff; nothing in clay is pure white
  // sky & light
  skyLow: '#ffd9a0',
  skyHigh: '#aee1f5',
  keyLight: '#ffe3c0',
  fillSky: '#bcd7ff',
  fillGround: '#e8b087',
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
