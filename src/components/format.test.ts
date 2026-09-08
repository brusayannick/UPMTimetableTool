import { describe, expect, it } from 'vitest'
import { creditsOfDetails, guideLinkLabel } from './format.ts'

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

describe('guideLinkLabel', () => {
  it('labels guide URLs by language and plan', () => {
    expect(
      guideLinkLabel('https://www.upm.es/comun_gauss/publico/guias/2026-27/GA_10BA_103000892_EN_2026-27.pdf'),
    ).toEqual({ language: 'English', plan: '10BA' })
    expect(
      guideLinkLabel('https://www.upm.es/comun_gauss/publico/guias/2026-27/GA_10AN_103000924_ES_2026-27.pdf'),
    ).toEqual({ language: 'Spanish', plan: '10AN' })
  })

  it('returns null for non-guide URLs', () => {
    expect(guideLinkLabel('https://example.com/guide.pdf')).toBeNull()
    expect(guideLinkLabel('not a url')).toBeNull()
  })
})
