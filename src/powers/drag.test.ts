import { describe, expect, it } from 'vitest'
import { cameraRelativeOffset, pointInsideClientRect, pointerDragMode } from './drag'

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
