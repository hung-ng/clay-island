import { describe, expect, it } from 'vitest'
import { celebrationRewardView } from './journal'

describe('completed Journal reward', () => {
  it('stays hidden before all fifteen Moments are unlocked', () => {
    expect(celebrationRewardView(14, 'ready')).toEqual({
      hidden: true,
      disabled: true,
      label: 'Celebrate Again',
    })
  })

  it('is a separate ready control at fifteen Moments', () => {
    expect(celebrationRewardView(15, 'ready')).toEqual({
      hidden: false,
      disabled: false,
      label: 'Celebrate Again',
    })
  })

  it('communicates queued and active states without hiding the reward', () => {
    expect(celebrationRewardView(15, 'queued')).toMatchObject({
      hidden: false, disabled: true, label: 'Celebration waiting…',
    })
    expect(celebrationRewardView(15, 'active')).toMatchObject({
      hidden: false, disabled: true, label: 'Celebrating…',
    })
  })
})
