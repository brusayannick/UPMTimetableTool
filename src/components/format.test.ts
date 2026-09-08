import { describe, expect, it } from 'vitest'
import { creditsOfDetails, guideLinkLabel } from './format.ts'

describe('creditsOfDetails', () => {
  const row = (credits: string, name = 'Data Processes', englishName = 'Data Processes') => ({
    credits,
    name,
    englishName,
  })

  it('sums comma-decimal credits across distinct offerings', () => {
    expect(creditsOfDetails([row('4,5'), row('3', 'Big Data', 'Big Data')])).toBe(7.5)
    expect(creditsOfDetails([row('3', 'Big Data', 'Big Data'), row('3', 'Data Visualization', 'Data Visualization')])).toBe(6)
  })

  it('counts one offering once even when several plans list it', () => {
    expect(
      creditsOfDetails([
        { credits: '4,5', name: 'Machine Learning', englishName: 'Machine Learning' },
        { credits: '4,5', name: 'MACHINE LEARNING', englishName: 'MACHINE LEARNING' },
      ]),
    ).toBe(4.5)
  })

  it('returns null when nothing usable is stated', () => {
    expect(creditsOfDetails(undefined)).toBeNull()
    expect(creditsOfDetails([])).toBeNull()
    expect(creditsOfDetails([row('')])).toBeNull()
  })

  it('skips unparsable cells but keeps the rest', () => {
    expect(creditsOfDetails([row('n/a'), row('4,5')])).toBe(4.5)
  })

  it('returns null on conflicting credits for one offering', () => {
    expect(
      creditsOfDetails([
        { credits: '4,5', name: 'Machine Learning', englishName: 'Machine Learning' },
        { credits: '5', name: 'Machine Learning', englishName: 'Machine Learning' },
      ]),
    ).toBeNull()
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
