import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { prefersReducedMotion } from '../core/motion'
import { RNG } from '../core/rng'
import { MOMENTS, type MomentId } from '../discovery/moments'
import { clayMaterial } from '../fx/clayMaterial'
import { wobble } from '../fx/wobble'
import { PALETTE, TIMING, TYPE } from './tokens'

/** The book body is 7.2 x 5.05; these add margin for the wobble and the swung cover. */
const BOOK_EXTENT = { width: 7.9, height: 5.75 }

type BookTile = {
  plain: THREE.BufferGeometry
  pressed: THREE.BufferGeometry
  position: THREE.Vector3
  unlocked: boolean
  popping: boolean
  popUntil: number
}

function tileGeometry(rng: RNG, pressed: boolean): THREE.BufferGeometry {
  const geometry = wobble(new THREE.BoxGeometry(1.55, 0.72, 0.16, 12, 7, 2), rng, 0.028)
  if (!pressed) return geometry
  const position = geometry.getAttribute('position') as THREE.BufferAttribute
  for (let index = 0; index < position.count; index++) {
    if (position.getZ(index) < 0.05) continue
    const nx = position.getX(index) / 0.775
    const ny = position.getY(index) / 0.36
    const falloff = Math.max(0, 1 - Math.hypot(nx, ny))
    position.setZ(index, position.getZ(index) - falloff * falloff * 0.12)
  }
  position.needsUpdate = true
  geometry.computeVertexNormals()
  return geometry
}

function titleCanvas(title: string, rotation: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = 384
  canvas.height = 144
  const context = canvas.getContext('2d')!
  context.translate(canvas.width / 2, canvas.height / 2)
  context.rotate(rotation)
  context.fillStyle = PALETTE.ink
  context.font = `700 36px ${TYPE.display}`
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  const words = title.split(' ')
  if (words.length > 1) {
    const split = Math.ceil(words.length / 2)
    context.fillText(words.slice(0, split).join(' '), 0, -21)
    context.fillText(words.slice(split).join(' '), 0, 22)
  } else {
    context.fillText(title, 0, 0)
  }
  return canvas
}

export class ClayBook {
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.OrthographicCamera(-4.5, 4.5, 3.4, -3.4, 0.1, 30)
  private readonly root = new THREE.Group()
  private readonly coverPivot = new THREE.Group()
  private readonly tiles: BookTile[] = []
  private readonly titleCanvases: HTMLCanvasElement[] = []
  private readonly disposableMaterials: THREE.Material[] = []
  private readonly disposableGeometries: THREE.BufferGeometry[] = []
  private readonly tileMesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshToonMaterial>
  private readonly labelCanvas = document.createElement('canvas')
  private readonly labelContext: CanvasRenderingContext2D
  private readonly labelTexture: THREE.CanvasTexture
  private readonly labelMesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
  private rect = new DOMRect()
  private fitScale = 1
  private targetOpen = false
  private openness = 0
  private lastQt = Number.NEGATIVE_INFINITY
  private elapsed = 0
  private lastRenderCalls = 0

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly options: { lowFx: boolean },
  ) {
    const rng = new RNG(211)
    this.camera.position.set(0, 0.4, 12)
    this.camera.lookAt(0, 0, 0)

    const bodyGeometry = wobble(new THREE.BoxGeometry(7.2, 5.05, 0.48, 12, 8, 2), rng, 0.07)
    const bodyMaterial = clayMaterial(PALETTE.hutClay)
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial)
    body.castShadow = true
    body.receiveShadow = true
    this.root.add(body)

    const pagesGeometry = wobble(new THREE.BoxGeometry(6.72, 4.6, 0.28, 10, 7, 2), rng, 0.04)
    const pagesMaterial = clayMaterial(PALETTE.cloud, { flat: true })
    const pages = new THREE.Mesh(pagesGeometry, pagesMaterial)
    pages.position.z = 0.32
    pages.receiveShadow = true
    this.root.add(pages)

    const coverGeometry = wobble(new THREE.BoxGeometry(7.18, 5.02, 0.2, 12, 8, 2), rng, 0.06)
    const coverMaterial = clayMaterial(PALETTE.hutClay)
    const cover = new THREE.Mesh(coverGeometry, coverMaterial)
    cover.position.x = 3.59
    cover.castShadow = true
    this.coverPivot.position.set(-3.59, 0, 0.56)
    this.coverPivot.add(cover)
    this.root.add(this.coverPivot)

    this.disposableGeometries.push(bodyGeometry, pagesGeometry, coverGeometry)
    this.disposableMaterials.push(bodyMaterial, pagesMaterial, coverMaterial)

    MOMENTS.forEach((moment, index) => {
      const column = index % 3
      const row = Math.floor(index / 3)
      const plain = tileGeometry(rng, false)
      const pressed = tileGeometry(rng, true)
      this.tiles.push({
        plain,
        pressed,
        position: new THREE.Vector3((column - 1) * 2.05, 1.58 - row * 1.04, 0.58),
        unlocked: false,
        popping: false,
        popUntil: 0,
      })
      this.titleCanvases.push(titleCanvas(moment.title, rng.range(-0.025, 0.025)))
      this.disposableGeometries.push(plain, pressed)
    })

    const tileMaterial = clayMaterial(PALETTE.unmodulated)
    tileMaterial.vertexColors = true
    this.tileMesh = new THREE.Mesh(this.buildTileGeometry(), tileMaterial)
    this.tileMesh.castShadow = true
    this.tileMesh.receiveShadow = true
    this.root.add(this.tileMesh)
    this.disposableMaterials.push(tileMaterial)

    this.labelCanvas.width = 1024
    this.labelCanvas.height = 768
    this.labelContext = this.labelCanvas.getContext('2d')!
    this.labelTexture = new THREE.CanvasTexture(this.labelCanvas)
    this.labelTexture.colorSpace = THREE.SRGBColorSpace
    this.labelTexture.minFilter = THREE.LinearFilter
    this.labelTexture.magFilter = THREE.LinearFilter
    this.labelTexture.generateMipmaps = false
    const labelGeometry = new THREE.PlaneGeometry(7, 5)
    const labelMaterial = new THREE.MeshBasicMaterial({
      map: this.labelTexture,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    })
    this.labelMesh = new THREE.Mesh(labelGeometry, labelMaterial)
    this.labelMesh.position.z = 0.69
    this.labelMesh.visible = false
    this.root.add(this.labelMesh)
    this.disposableGeometries.push(labelGeometry)
    this.disposableMaterials.push(labelMaterial)

    const key = new THREE.DirectionalLight(PALETTE.keyLight, 3)
    key.position.set(5, 7, 9)
    const fill = new THREE.AmbientLight(PALETTE.fillSky, 1.35)
    this.scene.add(key, fill, this.root)
  }

  get isOpen(): boolean { return this.targetOpen }
  get drawCalls(): number { return this.lastRenderCalls }

  open(): void {
    this.targetOpen = true
    if (prefersReducedMotion()) this.openness = 1
  }

  close(): void {
    this.targetOpen = false
    if (prefersReducedMotion()) this.openness = 0
  }

  setRect(rect: DOMRect): void {
    this.rect = rect
    if (rect.width <= 0 || rect.height <= 0) return
    // The frustum tracks the DOM rect's aspect, and the book is scaled to fit inside
    // it. Fitting (rather than cropping) keeps the tiles at fixed normalized positions,
    // so the invisible DOM buttons stay glued to their clay tiles at every dialog size.
    const aspect = rect.width / rect.height
    const height = BOOK_EXTENT.height
    const width = height * aspect
    this.fitScale = Math.min(1, width / BOOK_EXTENT.width)
    this.camera.left = -width / 2
    this.camera.right = width / 2
    this.camera.top = height / 2
    this.camera.bottom = -height / 2
    this.camera.updateProjectionMatrix()
  }

  setUnlocked(unlocked: ReadonlySet<MomentId>): void {
    let changed = false
    this.tiles.forEach((tile, index) => {
      const next = unlocked.has(MOMENTS[index].id)
      if (next === tile.unlocked) return
      tile.unlocked = next
      tile.popUntil = next ? this.elapsed + 2 / TIMING.fps : 0
      tile.popping = next
      changed = true
    })
    if (!changed) return
    this.rebuildTiles()
    this.redrawLabels()
  }

  update(dt: number, qt: number): void {
    this.elapsed += dt
    if (!prefersReducedMotion() && qt !== this.lastQt) {
      this.lastQt = qt
      this.openness = THREE.MathUtils.clamp(
        this.openness + (this.targetOpen ? 1 / 7 : -1 / 7),
        0,
        1,
      )
    }
    const eased = 1 - (1 - this.openness) ** 3
    this.coverPivot.rotation.y = -Math.PI * 0.94 * eased
    this.root.rotation.x = THREE.MathUtils.lerp(-0.08, 0.04, eased)
    this.root.rotation.z = THREE.MathUtils.lerp(-0.08, 0, eased)
    this.root.scale.setScalar(THREE.MathUtils.lerp(0.84, 1, eased) * this.fitScale)

    let popChanged = false
    for (const tile of this.tiles) {
      const popping = tile.popUntil > this.elapsed
      if (popping === tile.popping) continue
      tile.popping = popping
      popChanged = true
    }
    if (popChanged) this.rebuildTiles()
  }

  render(): void {
    if (
      this.options.lowFx
      || prefersReducedMotion()
      || this.rect.width < 1
      || this.rect.height < 1
    ) return
    const y = this.renderer.domElement.clientHeight - this.rect.bottom
    const previousAutoClear = this.renderer.autoClear
    this.renderer.setScissorTest(true)
    this.renderer.setViewport(this.rect.left, y, this.rect.width, this.rect.height)
    this.renderer.setScissor(this.rect.left, y, this.rect.width, this.rect.height)
    this.renderer.autoClear = false
    this.renderer.clearDepth()
    this.renderer.render(this.scene, this.camera)
    this.lastRenderCalls = this.renderer.info.render.calls
    this.renderer.setScissorTest(false)
    this.renderer.autoClear = previousAutoClear
    this.renderer.setViewport(
      0,
      0,
      this.renderer.domElement.clientWidth,
      this.renderer.domElement.clientHeight,
    )
  }

  dispose(): void {
    this.tileMesh.geometry.dispose()
    this.labelTexture.dispose()
    for (const material of this.disposableMaterials) material.dispose()
    for (const geometry of this.disposableGeometries) geometry.dispose()
  }

  private buildTileGeometry(): THREE.BufferGeometry {
    const color = new THREE.Color()
    const matrix = new THREE.Matrix4()
    const rotation = new THREE.Quaternion()
    const parts = this.tiles.map((tile, index) => {
      const geometry = (tile.unlocked ? tile.pressed : tile.plain).clone()
      color.set(tile.unlocked ? MOMENTS[index].color : PALETTE.stone)
      const count = geometry.getAttribute('position').count
      const colors = new Float32Array(count * 3)
      for (let vertex = 0; vertex < count; vertex++) color.toArray(colors, vertex * 3)
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
      const scale = tile.popping ? 1.09 : 1
      matrix.compose(tile.position, rotation, new THREE.Vector3(scale, scale, scale))
      geometry.applyMatrix4(matrix)
      return geometry
    })
    const merged = mergeGeometries(parts, false)
    for (const part of parts) part.dispose()
    if (!merged) throw new Error('book tile geometry could not be merged')
    return merged
  }

  private rebuildTiles(): void {
    const previous = this.tileMesh.geometry
    this.tileMesh.geometry = this.buildTileGeometry()
    previous.dispose()
  }

  private redrawLabels(): void {
    this.labelContext.clearRect(0, 0, this.labelCanvas.width, this.labelCanvas.height)
    let visible = false
    this.tiles.forEach((tile, index) => {
      if (!tile.unlocked) return
      visible = true
      const x = (tile.position.x + 3.5) / 7 * this.labelCanvas.width
      const y = (2.5 - tile.position.y) / 5 * this.labelCanvas.height
      this.labelContext.drawImage(this.titleCanvases[index], x - 150, y - 52, 300, 104)
    })
    this.labelMesh.visible = visible
    this.labelTexture.needsUpdate = true
  }
}
