import * as THREE from 'three'
import { RNG } from '../core/rng'
import { clayMaterial } from '../fx/clayMaterial'
import { wobble } from '../fx/wobble'
import { fitTitle, type Glyph, type Stroke } from './clayLettering'
import { PALETTE, TIMING } from './tokens'

const WORDS = ['CLAY', 'ISLAND'] as const
/** Each letter a different lump of the village's clay. */
const COLORS = [PALETTE.smockA, PALETTE.smockB, PALETTE.smockC, PALETTE.leafA, PALETTE.bloom]
/** Distance in front of the camera; the island sits well behind this. */
const DEPTH = 12
/** Coil radius, in cap heights. */
const COIL = 0.088
/** Largest cap height, in world units at DEPTH (about an eighth of the view). */
const CAP_HEIGHT = 0.95
/** The lettering's centre sits this share of the view above the middle. */
const LIFT = 0.12

const ENTER_STAGGER = 0.07
const ENTER_SECONDS = 0.5
const LEAVE_STAGGER = 0.05
const LEAVE_SECONDS = 0.6

const UP = new THREE.Vector3(0, 1, 0)

function coil(from: THREE.Vector3, to: THREE.Vector3, rng: RNG): THREE.BufferGeometry {
  const geometry = new THREE.CapsuleGeometry(COIL, from.distanceTo(to), 6, 14)
  geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, to.clone().sub(from).normalize()))
  const middle = from.clone().add(to).multiplyScalar(0.5)
  geometry.translate(middle.x, middle.y, middle.z)
  return wobble(geometry, rng, 0.012)
}

function ball(at: THREE.Vector3, rng: RNG): THREE.BufferGeometry {
  const geometry = new THREE.SphereGeometry(COIL, 14, 10)
  geometry.translate(at.x, at.y, at.z)
  return wobble(geometry, rng, 0.008)
}

function strokeGeometries(stroke: Stroke, offsetX: number, rng: RNG): THREE.BufferGeometry[] {
  const points = stroke.points.map(([x, y]) => new THREE.Vector3(x - offsetX, y, 0))
  if (!stroke.smooth) {
    const parts: THREE.BufferGeometry[] = []
    for (let i = 1; i < points.length; i++) parts.push(coil(points[i - 1]!, points[i]!, rng))
    return parts
  }
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal')
  const tube = wobble(new THREE.TubeGeometry(curve, 64, COIL, 14, false), rng, 0.012)
  return [tube, ball(points[0]!, rng), ball(points.at(-1)!, rng)]
}

type Letter = { group: THREE.Group; index: number }

/**
 * The title, rolled from clay coils and held in front of the camera, so it
 * stays put while the island turns behind it. It plops in letter by letter,
 * bobs at the villagers' 12fps, and hops away when play begins.
 */
export class TitleLetters {
  private readonly root = new THREE.Group()
  private readonly letters: Letter[] = []
  private state: 'hidden' | 'entering' | 'idle' | 'leaving' = 'hidden'
  private elapsed = 0
  private aspect = 0

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    scene: THREE.Scene,
    private readonly reducedMotion: () => boolean,
  ) {
    this.root.name = 'title-letters'
    this.root.visible = false
    // Children of the camera only draw when the camera is in the scene graph.
    if (!camera.parent) scene.add(camera)
    camera.add(this.root)

    const rng = new RNG(1717)
    const { layout } = fitTitle(WORDS, 1, 1, 1)
    layout.glyphs.forEach((placed, index) => {
      const material = clayMaterial(COLORS[index % COLORS.length]!)
      const group = new THREE.Group()
      group.name = `title-letter-${placed.char}`
      for (const geometry of this.glyphGeometries(placed.glyph, rng)) {
        group.add(new THREE.Mesh(geometry, material))
      }
      this.root.add(group)
      this.letters.push({ group, index })
    })
  }

  show(): void {
    this.state = this.reducedMotion() ? 'idle' : 'entering'
    this.elapsed = 0
    this.root.visible = true
    this.aspect = 0
  }

  dismiss(): void {
    if (this.state === 'hidden') return
    if (this.reducedMotion()) {
      this.hide()
      return
    }
    this.state = 'leaving'
    this.elapsed = 0
  }

  hide(): void {
    this.state = 'hidden'
    this.root.visible = false
  }

  update(dt: number): void {
    if (this.state === 'hidden') return
    if (this.camera.aspect !== this.aspect) this.relayout()
    this.elapsed += dt
    // Held to the stop-motion frame rate, like the villagers.
    const held = Math.floor(this.elapsed * TIMING.fps) / TIMING.fps
    const reduced = this.reducedMotion()
    let allGone = true

    for (const letter of this.letters) {
      const { group, index } = letter
      const base = group.userData.base as THREE.Vector3
      let lift = 0
      let squash = 1
      let tilt = 0
      group.visible = true

      if (this.state === 'entering') {
        const p = (held - index * ENTER_STAGGER) / ENTER_SECONDS
        if (p < 0) {
          group.visible = false
        } else if (p < 0.45) {
          lift = 1.4 * (1 - (p / 0.45) ** 2)
          squash = 1.12
        } else if (p < 0.65) {
          squash = 1 - 0.3 * Math.sin(Math.PI * (p - 0.45) / 0.2)
        } else if (p < 1) {
          squash = 1 + 0.08 * Math.sin(Math.PI * (p - 0.65) / 0.35)
        }
        if (index === this.letters.length - 1 && p >= 1) {
          this.state = 'idle'
          this.elapsed = 0
        }
      } else if (this.state === 'idle' && !reduced) {
        lift = Math.sin(held * 2.1 + index * 0.7) * 0.035
        tilt = Math.sin(held * 1.3 + index * 1.1) * 0.035
      } else if (this.state === 'leaving') {
        const p = Math.max(0, (held - index * LEAVE_STAGGER) / LEAVE_SECONDS)
        if (p < 0.35) {
          lift = 0.45 * Math.sin((p / 0.35) * Math.PI / 2)
          squash = p < 0.1 ? 0.8 : 1.1
        } else {
          lift = 0.45 - 10 * ((p - 0.35) / 0.65) ** 2
          tilt = (p - 0.35) * (index % 2 === 0 ? 1.4 : -1.4)
        }
        if (p < 1) allGone = false
        else group.visible = false
      }

      group.position.set(base.x, base.y + lift, 0)
      group.scale.set(1 / Math.sqrt(squash), squash, 1 / Math.sqrt(squash))
      group.rotation.z = tilt
    }

    if (this.state === 'leaving' && allGone) this.hide()
  }

  private relayout(): void {
    this.aspect = this.camera.aspect
    const viewHeight = 2 * DEPTH * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))
    const viewWidth = viewHeight * this.aspect
    const { layout, scale } = fitTitle(WORDS, viewWidth, viewHeight, CAP_HEIGHT)
    this.root.position.set(0, viewHeight * LIFT, -DEPTH)
    this.root.scale.setScalar(scale)
    layout.glyphs.forEach((placed, index) => {
      const letter = this.letters[index]!
      // Pivot at the foot of the letter so it squashes onto its base.
      letter.group.userData.base = new THREE.Vector3(placed.x + placed.glyph.width / 2, placed.y, 0)
    })
  }

  private glyphGeometries(glyph: Glyph, rng: RNG): THREE.BufferGeometry[] {
    return glyph.strokes.flatMap(stroke => strokeGeometries(stroke, glyph.width / 2, rng))
  }
}
