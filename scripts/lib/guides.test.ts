import { describe, expect, it } from 'vitest'
import { candidateGuideUrls, guideUrl, planCodePairs } from './guides.ts'

describe('guideUrl', () => {
  it('builds the verified GA_ pattern', () => {
    expect(guideUrl('10BA', '103000892', 'EN')).toBe(
      'https://www.upm.es/comun_gauss/publico/guias/2026-27/GA_10BA_103000892_EN_2026-27.pdf',
    )
  })
})

describe('planCodePairs', () => {
  it('zips the parallel Plans/Codes lists and skips non-numeric codes', () => {
    expect(planCodePairs('10AN, 10AZ, 10BA', '103001020, 103001003, 103000895')).toEqual([
      { plan: '10AN', code: '103001020' },
      { plan: '10AZ', code: '103001003' },
      { plan: '10BA', code: '103000895' },
    ])
    expect(planCodePairs('10II', 'TBD')).toEqual([])
    expect(planCodePairs('', '')).toEqual([])
  })

  it('dedupes repeated pairs', () => {
    expect(planCodePairs('10AM, 10AZ', '103000885, 103000885')).toEqual([
      { plan: '10AM', code: '103000885' },
      { plan: '10AZ', code: '103000885' },
    ])
  })
})

describe('candidateGuideUrls', () => {
  it('emits EN and ES for every pair', () => {
    expect(candidateGuideUrls('10AZ', '103000882')).toEqual([
      'https://www.upm.es/comun_gauss/publico/guias/2026-27/GA_10AZ_103000882_EN_2026-27.pdf',
      'https://www.upm.es/comun_gauss/publico/guias/2026-27/GA_10AZ_103000882_ES_2026-27.pdf',
    ])
  })
})
