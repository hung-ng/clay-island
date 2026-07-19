import { expect, it } from 'vitest'
import { TIME_OF_DAY_OPTIONS } from './settings'

it('offers exactly Auto, Day, and Night in that order', () => {
  expect(TIME_OF_DAY_OPTIONS.map(option => option.value)).toEqual(['auto', 'day', 'night'])
  expect(TIME_OF_DAY_OPTIONS.map(option => option.label)).toEqual(['Auto', 'Day', 'Night'])
})
