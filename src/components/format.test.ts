import { describe, expect, it } from 'vitest'
import { creditsOfDetails } from './format.ts'

describe('creditsOfDetails', () => {
  it('sums comma-decimal credits across rows', () => {
    expect(creditsOfDetails([{ credits: '4,5' }, { credits: '6' }])).toBe(10.5)
    expect(creditsOfDetails([{ credits: '3' }, { credits: '3' }])).toBe(6)
  })

  it('returns null when nothing usable is stated', () => {
    expect(creditsOfDetails(undefined)).toBeNull()
    expect(creditsOfDetails([])).toBeNull()
    expect(creditsOfDetails([{ credits: '' }])).toBeNull()
  })

  it('skips unparsable cells but keeps the rest', () => {
    expect(creditsOfDetails([{ credits: 'n/a' }, { credits: '4,5' }])).toBe(4.5)
  })
})
