import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Island } from '../world/island'
import type { World } from '../world/world'
import { cameraRelativeOffset, pointInsideClientRect, pointerDragMode } from './drag'

afterEach(() => vi.unstubAllGlobals())

describe('pointer drag cancellation', () => {
  const buttonRect = { left: 10, right: 90, top: 20, bottom: 80 }

  it('recognizes a release inside or on the edge of the originating button', () => {
    expect(pointInsideClientRect(50, 50, buttonRect)).toBe(true)
    expect(pointInsideClientRect(10, 20, buttonRect)).toBe(true)
    expect(pointInsideClientRect(90, 80, buttonRect)).toBe(true)
  })

  it('does not cancel a release outside the originating button', () => {
    expect(pointInsideClientRect(9, 50, buttonRect)).toBe(false)
    expect(pointInsideClientRect(50, 81, buttonRect)).toBe(false)
  })

  it('previews cancellation only while the pointer is over its originating button', () => {
    expect(pointerDragMode(50, 50, buttonRect)).toBe('cancel')
    expect(pointerDragMode(9, 50, buttonRect)).toBe('target')
    expect(pointerDragMode(50, 50, null)).toBe('target')
  })
})

describe('keyboard target movement', () => {
  it('maps arrows to the screen axes at the initial camera angle', () => {
    expect(cameraRelativeOffset('ArrowUp', 0, -1)).toEqual([0, -2])
    expect(cameraRelativeOffset('ArrowDown', 0, -1)).toEqual([0, 2])
    expect(cameraRelativeOffset('ArrowRight', 0, -1)).toEqual([2, 0])
    expect(cameraRelativeOffset('ArrowLeft', 0, -1)).toEqual([-2, 0])
  })

  it('rotates arrow movement with the orbiting camera', () => {
    expect(cameraRelativeOffset('ArrowUp', -1, 0)).toEqual([-2, 0])
    expect(cameraRelativeOffset('ArrowRight', -1, 0)).toEqual([0, -2])
  })

  it('normalizes the horizontal camera direction and ignores other keys', () => {
    expect(cameraRelativeOffset('ArrowUp', 3, 4)).toEqual([1.2, 1.6])
    expect(cameraRelativeOffset('Enter', 0, -1)).toBeNull()
  })
})

describe('camera-lock activity', () => {
  it('reports one active interval from arming through shared cancellation', async () => {
    class FakeButton {
      focus(): void {}
    }
    const classList = { add: vi.fn(), remove: vi.fn() }
    const liveRegion = {
      className: '',
      classList,
      textContent: '',
      setAttribute: vi.fn(),
    }
    const context = {
      createLinearGradient: () => ({ addColorStop: vi.fn() }),
      fillRect: vi.fn(),
      fillStyle: '',
    }
    const canvas = { width: 0, height: 0, getContext: () => context }
    const button = new FakeButton()
    vi.stubGlobal('HTMLButtonElement', FakeButton)
    vi.stubGlobal('document', {
      activeElement: button,
      body: { appendChild: vi.fn() },
      addEventListener: vi.fn(),
      querySelector: vi.fn(),
      getElementById: () => ({ appendChild: vi.fn() }),
      createElement: (tag: string) => tag === 'canvas' ? canvas : liveRegion,
    })
    vi.stubGlobal('addEventListener', vi.fn())

    const island = {
      group: new THREE.Group(),
      sampleHeight: () => 0,
    } as unknown as Island
    const world = { resolveTarget: () => 'ground' } as unknown as World
    const activeChanges: boolean[] = []
    const { DragTargeting } = await import('./drag')
    const subject = new DragTargeting(
      { style: { cursor: '' } } as HTMLElement,
      new THREE.PerspectiveCamera(),
      island,
      world,
      vi.fn(),
      active => activeChanges.push(active),
    )

    subject.arm('meteor')
    subject.cancel()
    subject.cancel()
    expect(activeChanges).toEqual([true, false])
  })
})
