import { describe, expect, it } from 'vitest'
import { matchDetails, parseCatalogue } from './details.ts'

const CSV = [
  'Plans;Codes;Name;English name;Year;Credits;Language;Semester;Group;Level;Available undergrad;Final level;Plan;Code;Quota;Learning guide;Observations',
  '10AZ;103000882;ASSISTIVE PRODUCTS;ASSISTIVE PRODUCTS;2;4,5;Inglés;1S;;Master;;;;3;#REF!;',
  '10AN, 10AZ, 10BA;103001020, 103001003, 103000893;BIG DATA;BIG DATA;2;3;Inglés;1S;;Master;;;;;#REF!;',
  '10AZ;103000881;ADAPTIVE SYSTEMS    ;ADAPTIVE SYSTEMS    ;2;4,5;Inglés;1S;;Master;;;;;#REF!;',
  '10II;105000021;BASES DE DATOS;DATABASES;2;6;EF;2S;;Bachelor;;;;;#REF!;',
].join('\r\n')

describe('parseCatalogue', () => {
  it('parses semicolon rows, strips BOM and #REF! cells', () => {
    const rows = parseCatalogue('\uFEFF' + CSV)
    expect(rows.length).toBe(4)
    expect(rows[0]).toMatchObject({
      plans: '10AZ',
      codes: '103000882',
      name: 'ASSISTIVE PRODUCTS',
      credits: '4,5',
      level: 'Master',
      learningGuide: '',
    })
  })

  it('keeps quoted cells with embedded newlines together', () => {
    const rows = parseCatalogue(
      'Plans;Codes;Name;English name;Year;Credits;Language;Semester;Group;Level;Available undergrad;Final level;Plan;Code;Quota;Learning guide;Observations\r\n' +
        '10AZ;1;X;X;1;3;Inglés;1S;;Master;;;;;;#REF!;"line one\nline two"',
    )
    expect(rows.length).toBe(1)
    expect(rows[0]!.quota).toBe('')
    expect(rows[0]!.learningGuide).toBe('')
    expect(rows[0]!.observations).toBe('line one\nline two')
  })
})

describe('matchDetails', () => {
  const rows = parseCatalogue(CSV)

  it('matches on either name cell after normalisation', () => {
    const { byKey, report } = matchDetails(
      [{ key: 'assistive-products', name: 'Assistive Products' }],
      rows,
      {},
    )
    expect(byKey.get('assistive-products')?.length).toBe(1)
    expect(report.unmatchedCourses).toEqual([])
  })

  it('strips MUIA timetable codes before matching', () => {
    const { byKey } = matchDetails(
      [{ key: 'a11-logic-programming', name: 'A11: Logic Programming' }],
      parseCatalogue(
        'Plans;Codes;Name;English name;Year;Credits;Language;Semester;Group;Level;Available undergrad;Final level;Plan;Code;Quota;Learning guide;Observations\r\n' +
          '10AJ;103000364;PROGRAMACION LOGICA;LOGIC PROGRAMMING;1;5;Inglés;1S;;Master;;;;;#REF!;',
      ),
      {},
    )
    expect(byKey.get('a11-logic-programming')?.[0]?.codes).toBe('103000364')
  })

  it('applies curated extras and reports leftovers honestly', () => {
    const { byKey, report } = matchDetails(
      [
        { key: 'big-data-data-visualization', name: 'Big Data / Data Visualization' },
        { key: 'no-such-course', name: 'No Such Course' },
      ],
      rows,
      {
        'Big Data / Data Visualization': ['BIG DATA'],
        'Stale Mapping': ['NOT IN THE CSV'],
      },
    )
    expect(byKey.get('big-data-data-visualization')?.[0]?.codes).toContain('103001020')
    expect(report.unmatchedCourses).toEqual(['No Such Course'])
    expect(report.unusedExtras).toEqual(['Stale Mapping → NOT IN THE CSV'])
  })

  it('matches the real A10 row despite its AMD/BIOCIRCUITS quirks', () => {    const rows = parseCatalogue(
      'Plans;Codes;Name;English name;Year;Credits;Language;Semester;Group;Level;Available undergrad;Final level;Plan;Code;Quota;Learning guide;Observations\r\n' +
        '10AJ;103000363;BIOLOGÍA PROGRAMABLE: COMPUTACIÓN CON ADN E INGENIERÍA DE BIOCIRCUITOS;PROGRAMMABLE BIOLOGY: DNA COMPUTING AMD BIOCIRCUITS ENGINEERING;1;5;Inglés;1S;;Master;;Master;#REF!;#REF!;4;#REF!;;;;',
    )
    const { byKey, report } = matchDetails(
      [{ key: 'a10-programmable-biology-dna-computing-and-biocircuit-engineering', name: 'A10: Programmable Biology: DNA Computing and Biocircuit Engineering' }],
      rows,
      { 'A10: Programmable Biology: DNA Computing and Biocircuit Engineering': ['PROGRAMMABLE BIOLOGY: DNA COMPUTING AMD BIOCIRCUITS ENGINEERING'] },
    )
    expect(byKey.size).toBe(1)
    expect(report.unusedExtras).toEqual([])
  })
})

describe('catalogue scope and offering conflicts', () => {
  const header =
    'Plans;Codes;Name;English name;Year;Credits;Language;Semester;Group;Level;Available undergrad;Final level;Plan;Code;Quota;Learning guide;Observations'
  const csv = [
    header,
    '10AZ, 10BA;103000826, 103000897;MACHINE LEARNING;MACHINE LEARNING;1;4,5;Inglés;1S;;Master;;;;;#REF!;',
    '10AJ;103000360;APRENDIZAJE AUTOMATICO;MACHINE LEARNING;1;5;Inglés;1S;;Master;;;;;#REF!;',
    '10II;105000044;SISTEMAS INTELIGENTES;INTELLIGENT SYSTEMS;2;6;EF;2S;;Bachelor;;;;;#REF!;',
    '10AN, 10AZ;103000606, 103000851;INTELLIGENT SYSTEMS;INTELLIGENT SYSTEMS;1;4,5;Inglés;1S;;Master;;;;;#REF!;',
  ].join('\r\n')
  const rows = parseCatalogue(csv)

  it('ignores bachelor rows even when the name matches', () => {
    const { byKey } = matchDetails(
      [{ key: 'intelligent-systems', name: 'Intelligent Systems' }],
      rows,
      {},
      {},
    )
    expect(byKey.get('intelligent-systems')?.map((r) => r.codes)).toEqual(['103000606, 103000851'])
  })

  it('resolves same-name credit conflicts by preferred plan', () => {
    const { byKey, report } = matchDetails(
      [{ key: 'a5-machine-learning', name: 'A5: Machine Learning' }],
      rows,
      {},
      { 'A5: Machine Learning': ['10AJ'] },
    )
    expect(byKey.get('a5-machine-learning')?.map((r) => r.codes)).toEqual(['103000360'])
    expect(report.ambiguousCourses).toEqual([])
  })

  it('reports conflicts with no preferred plan instead of summing', () => {
    const { byKey, report } = matchDetails(
      [{ key: 'a5-machine-learning', name: 'A5: Machine Learning' }],
      rows,
      {},
      {},
    )
    expect(byKey.get('a5-machine-learning')?.length).toBe(2)
    expect(report.ambiguousCourses.length).toBe(1)
  })
})
