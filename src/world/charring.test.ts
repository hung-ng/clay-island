import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { PALETTE } from '../ui/tokens'
import { Charring } from './charring'

const SCORCH = new THREE.Color(PALETTE.scorch)

const material = (color: string): THREE.MeshToonMaterial =>
  new THREE.MeshToonMaterial({ color })

describe('Charring', () => {
  it('leaves materials at their base colour when pristine', () => {
    const clay = material('#ff0000')
    const charring = new Charring([clay])

    charring.set(0)

    expect(clay.color.getHex()).toBe(0xff0000)
  })

  it('drives EVERY material it owns, not just the first', () => {
    const base = material('#ff0000')
    const door = material('#00ff00')
    const knob = material('#0000ff')
    const charring = new Charring([base, door, knob])

    charring.set(1)

    for (const owned of [base, door, knob]) {
      expect(owned.color.getHex()).toBe(SCORCH.getHex())
    }
  })

  it('interpolates between the base colour and scorch', () => {
    const clay = material('#ff0000')
    const charring = new Charring([clay])

    charring.set(0.5)

    const expected = new THREE.Color('#ff0000').lerp(SCORCH, 0.5)
    expect(clay.color.getHex()).toBe(expected.getHex())
  })

  it('RESTORES the base colour when driven back to 0 — a rebuilt hut is not black', () => {
    const clay = material('#ff0000')
    const charring = new Charring([clay])

    charring.set(1)
    charring.set(0)

    expect(clay.color.getHex()).toBe(0xff0000)
  })

  it('clamps out-of-range amounts', () => {
    const clay = material('#ff0000')
    const charring = new Charring([clay])

    charring.set(5)
    expect(charring.amount).toBe(1)

    charring.set(-3)
    expect(charring.amount).toBe(0)
    expect(clay.color.getHex()).toBe(0xff0000)
  })

  it('reports the amount it was set to', () => {
    const charring = new Charring([material('#ff0000')])
    charring.set(0.25)
    expect(charring.amount).toBeCloseTo(0.25)
  })

  it('captures the base colour of materials added later', () => {
    const trunk = material('#ff0000')
    const charring = new Charring([trunk])
    const leaf = material('#00ff00')

    charring.add(leaf)
    charring.set(1)
    charring.set(0)

    expect(leaf.color.getHex()).toBe(0x00ff00)
  })
})
