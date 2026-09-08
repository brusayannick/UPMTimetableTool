import { describe, expect, it } from 'vitest'
import { candidateGuideUrls, extractGuideLanguage, guidePair, guideUrl, planCodePairs } from './guides.ts'

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

describe('extractGuideLanguage', () => {
  it('reads the EN header block', () => {
    expect(
      extractGuideLanguage(['LANGUAGE ASSIGNED CENTER', 'ENGLISH E.T.S. DE INGENIEROS INFORMÁTICOS']),
    ).toBe('EN')
  })

  it('reads the ES header block', () => {
    expect(
      extractGuideLanguage(['IDIOMA CENTRO RESPONSABLE', 'ESPAÑOL E.T.S. DE INGENIEROS INFORMÁTICOS']),
    ).toBe('ES')
  })

  it('ignores competency prose about languages', () => {
    expect(
      extractGuideLanguage(['CG03 La capacidad de usar la lengua inglesa de manera competente']),
    ).toBeNull()
  })

  it('returns null on silence', () => {
    expect(extractGuideLanguage(['COURSE 2', 'CREDITS 4.5 ECTS'])).toBeNull()
  })

  it('skips keyword uses without a value (titles, competency prose)', () => {
    expect(
      extractGuideLanguage([
        'L.G. GENERATIVE AI AND LANGUAGE MODELS',
        'CG03 La capacidad de usar la lengua inglesa de manera competente',
        'LANGUAGE ASSIGNED CENTER',
        'ENGLISH E.T.S. DE INGENIEROS INFORMÁTICOS',
      ]),
    ).toBe('EN')
  })
})

describe('guidePair', () => {
  it('recovers plan and code from a guide URL', () => {
    expect(guidePair('https://www.upm.es/comun_gauss/publico/guias/2026-27/GA_10AZ_103000882_EN_2026-27.pdf')).toEqual({
      plan: '10AZ',
      code: '103000882',
    })
    expect(guidePair('https://example.com/other.pdf')).toBeNull()
  })
})
