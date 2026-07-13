import { describe, expect, it } from 'vitest'
import { cameraRelativeOffset } from './drag'

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
