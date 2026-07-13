import * as THREE from 'three'
import { PALETTE, TIMING, TYPE } from '../ui/tokens'

export type EmoteKind = 'alarm' | 'question' | 'water' | 'sleep' | 'fish' | 'sad'

const KINDS: EmoteKind[] = ['alarm', 'question', 'water', 'sleep', 'fish', 'sad']
const GLYPHS: Record<EmoteKind, string> = {
  alarm: '!',
  question: '?',
  water: '≋',
  sleep: 'z',
  fish: '><>',
  sad: '︵',
}

const CELL = 64
let sharedAtlas: THREE.CanvasTexture | null = null

function drawBubble(context: CanvasRenderingContext2D, cell: number): void {
  const cx = cell * CELL + CELL / 2
  const cy = CELL / 2 - 2
  const radii = [23, 21.8, 23.7]
  context.beginPath()
  for (let i = 0; i < 3; i++) {
    const start = (i / 3) * Math.PI * 2
    const end = ((i + 1) / 3) * Math.PI * 2
    context.arc(cx, cy, radii[i], start, end)
  }
  context.closePath()
  context.fillStyle = PALETTE.paper
  context.fill()
  context.lineWidth = 2.5
  context.lineCap = 'round'
  context.lineJoin = 'round'
  context.strokeStyle = PALETTE.inkSoft
  context.stroke()

  context.beginPath()
  context.moveTo(cx - 7, cy + 20)
  context.lineTo(cx - 2, cy + 29)
  context.lineTo(cx + 4, cy + 21)
  context.fillStyle = PALETTE.paper
  context.fill()
  context.strokeStyle = PALETTE.inkSoft
  context.stroke()
}

function createAtlas(): THREE.CanvasTexture {
  if (sharedAtlas) return sharedAtlas
  const canvas = document.createElement('canvas')
  canvas.width = CELL * KINDS.length
  canvas.height = CELL
  const context = canvas.getContext('2d')!
  context.clearRect(0, 0, canvas.width, canvas.height)
  context.textAlign = 'center'
  context.textBaseline = 'middle'

  KINDS.forEach((kind, index) => {
    drawBubble(context, index)
    context.fillStyle = PALETTE.ink
    context.font = `700 ${kind === 'fish' ? 22 : 34}px ${TYPE.display}`
    context.fillText(GLYPHS[kind], index * CELL + CELL / 2, CELL / 2 - 3)
  })

  sharedAtlas = new THREE.CanvasTexture(canvas)
  sharedAtlas.colorSpace = THREE.SRGBColorSpace
  sharedAtlas.minFilter = THREE.LinearFilter
  sharedAtlas.magFilter = THREE.LinearFilter
  sharedAtlas.generateMipmaps = false
  return sharedAtlas
}

export class EmoteSprite {
  sprite: THREE.Sprite

  private map: THREE.Texture
  private duration = 0
  private startedAt = Number.NaN
  private lastQt = Number.NEGATIVE_INFINITY

  constructor() {
    this.map = createAtlas().clone()
    this.map.repeat.set(1 / KINDS.length, 1)
    this.map.needsUpdate = true
    const material = new THREE.SpriteMaterial({ map: this.map, transparent: true })
    this.sprite = new THREE.Sprite(material)
    this.sprite.position.y = 1.42
    this.sprite.scale.setScalar(0.01)
    this.sprite.visible = false
    this.sprite.renderOrder = 3
  }

  show(kind: EmoteKind, seconds: number): void {
    this.map.offset.x = KINDS.indexOf(kind) / KINDS.length
    this.duration = seconds
    this.startedAt = Number.NaN
    this.lastQt = Number.NEGATIVE_INFINITY
    this.sprite.visible = true
  }

  update(qt: number): void {
    if (!this.sprite.visible || qt === this.lastQt) return
    this.lastQt = qt
    if (Number.isNaN(this.startedAt)) this.startedAt = qt

    const elapsed = qt - this.startedAt
    if (elapsed >= this.duration) {
      this.sprite.visible = false
      return
    }

    const frame = Math.floor(elapsed * TIMING.fps)
    const pop = frame === 0 ? 0.35 : frame === 1 ? 0.72 : 1
    this.sprite.scale.setScalar(0.86 * pop)
    this.sprite.position.y = 1.42 + (frame % 4 === 1 || frame % 4 === 2 ? 0.045 : 0)
  }
}
