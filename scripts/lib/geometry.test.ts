/**
 * Golden tests for the geometry toolkit, run against the committed extraction
 * JSONs — never against a PDF. Every expected number in here was read off a real
 * file in the corpus.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  assignBandsToLabels,
  blocksInBand,
  colGridFromHeaderLines,
  groupRunsIntoLines,
  partitionBandIntoSpans,
  splitLineByGaps,
  stripAnnotations,
  assembleName,
  extractRoom,
  classifyBlock,
  type Line,
} from './geometry.ts'
import { normalise } from './normalize.ts'
import { bestMatch, score, THRESHOLDS } from './fuzzy.ts'
import { parseExamDate, parseTimeRange, parseWeekday, resolveValidity } from './time.ts'
import { EXTRACTED_DIR, slugFor } from './paths.ts'
import type { PdfExtraction } from './types.ts'

const load = (slug: string): PdfExtraction =>
  JSON.parse(readFileSync(join(EXTRACTED_DIR, `${slug}.json`), 'utf8')) as PdfExtraction

const DSC_1S = 'timetables--1885-dsc-muid-schedule-2026-27-1s'
const HMDA_1S = 'timetables--2481-hmda-muid-schedule-2026-27-1s'
const HMDA_3S = 'timetables--2481-hmda-muid-schedule-2026-27-3s'

describe('colGridFromHeaderLines', () => {
  it('reproduces the observed rect edges of the DSC 1S evening grid', () => {
    const ex = load(DSC_1S)
    const lines = groupRunsIntoLines(ex.runs)
    // Evening time header sits on baseline y≈410.6.
    const header = lines.filter((l) => Math.abs(l[0]!.y - 410.6) < 3)
    expect(header.length).toBe(1)

    const grid = colGridFromHeaderLines(header, { gridLeft: 59.52, gridRight: 815.04, where: 'dsc1s-evening' })
    expect(grid.cols.length).toBe(12)
    expect(grid.cols[0]!.startMin).toBe(15 * 60)
    expect(grid.cols[11]!.endMin).toBe(21 * 60)
    expect(grid.discontinuities).toEqual([])

    // The four interior rect edges actually drawn in the PDF.
    for (const observed of [194.4, 320.04, 449.76, 582.36]) {
      const nearest = Math.min(...grid.edges.map((e) => Math.abs(e - observed)))
      expect(nearest).toBeLessThan(5)
    }
  })

  it('throws on the corrupt DSC 1S morning header (duplicate 11:00-12:00)', () => {
    const ex = load(DSC_1S)
    const lines = groupRunsIntoLines(ex.runs)
    const header = lines.filter((l) => Math.abs(l[0]!.y - 490.1) < 3)
    expect(() =>
      colGridFromHeaderLines(header, { gridLeft: 59.52, gridRight: 815.04, where: 'dsc1s-morning' }),
    ).toThrow(/duplicate header label/)
  })

  it('reassembles two-line header cells in the HMDA 3S evening grid', () => {
    const ex = load(HMDA_3S)
    // The two half-grids sit on baselines that differ by 1pt; yTol must bridge that.
    const lines = groupRunsIntoLines(ex.runs, { yTol: 2 })
    const header = lines.filter((l) => l[0]!.y > 460 && l[0]!.y < 485 && l.some((r) => /\d{1,2}:\d{2}/.test(r.text)))
    const evening = header.map((l) => l.filter((r) => r.x > 300)).filter((l) => l.length > 0)
    const grid = colGridFromHeaderLines(evening, { gridLeft: 305.16, gridRight: 639.12, where: 'hmda3s-evening' })
    expect(grid.cols.length).toBe(6)
    expect(grid.cols.map((c) => c.startMin / 60)).toEqual([15, 16, 17, 18, 19, 20])
  })
})

describe('assignBandsToLabels', () => {
  it('maps row bands onto weekday labels monotonically', () => {
    // Synthetic: 4 bands, 2 weekday labels — each weekday claims at least one
    // band and the mapping never runs backwards.
    const bands = [
      { y0: 30, y1: 40 },
      { y0: 20, y1: 30 },
      { y0: 10, y1: 20 },
      { y0: 0, y1: 10 },
    ]
    const labels = [
      { y: 35, value: 1 as const },
      { y: 15, value: 2 as const },
    ]
    expect(assignBandsToLabels(bands, labels, 'synthetic')).toEqual([1, 1, 2, 2])
  })
})

describe('partitionBandIntoSpans', () => {
  // Row-union fills: one rectangle covers a whole HMDA 1S evening row holding
  // several courses, so spans are inferred from text position within the row.
  // These expectations match the sessions the timetable parser derives.
  const cases: { weekday: string; bandY: number; expect: [number, number][] }[] = [
    { weekday: 'Monday', bandY: 430.2, expect: [[1, 2], [3, 5]] },
    { weekday: 'Tuesday', bandY: 383.76, expect: [[0, 1], [2, 3], [4, 5]] },
    { weekday: 'Wednesday', bandY: 337.8, expect: [[0, 1], [2, 3]] },
    { weekday: 'Friday', bandY: 236.76, expect: [[0, 1]] },
  ]

  for (const c of cases) {
    it(`recovers the printed HMDA 1S evening blocks on ${c.weekday}`, () => {
      const ex = load(HMDA_1S)
      const lines = groupRunsIntoLines(ex.runs)
      const grid = eveningGridHmda1S(ex)

      const rowRect = ex.rects.find((r) => Math.abs(r.y - c.bandY) < 1 && r.x > 300 && r.w > 100)
      expect(rowRect, `row rect at y≈${c.bandY}`).toBeTruthy()

      const band = { y0: rowRect!.y, y1: rowRect!.y + rowRect!.h }
      const blocks = blocksInBand(
        lines.map((l) => l.filter((r) => r.x >= 305)).filter((l) => l.length > 0) as Line[],
        band,
        { minGapPt: 12 },
      )
      const result = partitionBandIntoSpans(blocks, grid, { a: 0, b: 5 })
      const got = result.spans
        .map((s) => [s.a, s.b] as [number, number])
        .sort((a, b) => a[0] - b[0])
      expect(got).toEqual(c.expect)
    })
  }
})

function eveningGridHmda1S(ex: PdfExtraction) {
  const lines = groupRunsIntoLines(ex.runs)
  const header = lines
    .filter((l) => l[0]!.y > 470 && l[0]!.y < 500)
    .map((l) => l.filter((r) => r.x > 300))
    .filter((l) => l.length > 0) as Line[]
  const grid = colGridFromHeaderLines(header, { gridLeft: 305.16, gridRight: 639.12, where: 'hmda1s-evening' })
  expect(grid.cols.length).toBe(6)
  return grid
}

describe('splitLineByGaps', () => {
  it('splits three cells sharing one baseline in DSC 1S', () => {
    const ex = load(DSC_1S)
    const lines = groupRunsIntoLines(ex.runs)
    // y≈351.1: `Statistical Data Analysis` ‖ `Intelligent Systems` ‖ `(elective)`
    const line = lines.find((l) => Math.abs(l[0]!.y - 351.1) < 2)
    expect(line).toBeTruthy()
    const segs = splitLineByGaps(line!, 12)
    expect(segs.length).toBeGreaterThanOrEqual(2)
    expect(segs.map((s) => s.map((r) => r.text).join('').trim())).toContain('Statistical Data Analysis')
  })
})

describe('stripAnnotations', () => {
  it('records an explicit range', () => {
    const r = stripAnnotations('I&E Study (10:00 to 12:00)')
    expect(r.name).toBe('I&E Study')
    expect(r.annotations).toEqual([
      { kind: 'explicitRange', startMin: 600, endMin: 720, raw: '(10:00 to 12:00)' },
    ])
  })

  it('records the HCID (10-12h.) notation', () => {
    const r = stripAnnotations('Introduction to Innovation and Entrepreneurship Management (10-12h.)')
    expect(r.annotations[0]).toMatchObject({ kind: 'explicitRange', startMin: 600, endMin: 720 })
  })

  it('records the Fintech inline half-hour override', () => {
    const r = stripAnnotations('Integration (15:00-16:30) ')
    expect(r.name).toBe('Integration')
    expect(r.annotations[0]).toMatchObject({ kind: 'explicitRange', startMin: 900, endMin: 990 })
  })

  it('records a bare start-time override', () => {
    const r = stripAnnotations('E-Health: Promoting Healthy Ageing 12:00 h.')
    expect(r.name).toBe('E-Health: Promoting Healthy Ageing')
    expect(r.annotations[0]).toMatchObject({ kind: 'startOverride', startMin: 720 })
  })

  it('records date and week ranges', () => {
    expect(stripAnnotations('Data Visualization (sep-oct)').annotations[0])
      .toMatchObject({ kind: 'dateRange', label: 'sep-oct' })
    expect(stripAnnotations('Verification and Validation (Weeks 1-7) ').annotations[0])
      .toMatchObject({ kind: 'weekRange', label: 'Weeks 1-7' })
  })

  it('records electives, stars and placeholders separately', () => {
    expect(stripAnnotations('Intelligent Systems (elective)').annotations[0]).toMatchObject({ kind: 'elective' })
    expect(stripAnnotations('Data Processes*').annotations[0]).toMatchObject({ kind: 'star' })
    const ph = stripAnnotations('Ethics for User Research 1 ////////')
    expect(ph.name).toBe('Ethics for User Research 1')
    expect(ph.annotations[0]).toMatchObject({ kind: 'placeholder' })
  })
})

describe('normalise', () => {
  const eq = (a: string, b: string): boolean => normalise(a).full === normalise(b).full

  it('bridges case, whitespace, accents, ampersand and commas', () => {
    expect(eq('Data Mining and Time series', 'Data Mining and Time Series')).toBe(true)
    expect(eq('Fundamentals of finance ', 'Fundamentals of Finance')).toBe(true)
    expect(eq('Complex  Data in Health ', 'Complex Data in Health')).toBe(true)
    expect(eq('Ingeniería Lingüística', 'Ingenieria Linguistica')).toBe(true)
    expect(eq('Data Management & Knowledge in Health', 'Data Management and Knowledge in Health')).toBe(true)
    expect(eq(
      'Management, Relationships and Communication in Working Groups',
      'Management Relationships and Communication in Working Groups',
    )).toBe(true)
  })

  it('bridges the eHealth spellings', () => {
    expect(eq('eHealth: Promoting Healthy Ageing', 'E-Health: Promoting Healthy Ageing')).toBe(true)
    expect(eq('E-health: Promoting Healthy Ageing', 'E-Health: Promoting Healthy Ageing')).toBe(true)
  })

  it('keeps hyphens as separators so Service-Oriented matches Service Oriented', () => {
    expect(eq('Service-Oriented Computing', 'Service Oriented Computing')).toBe(true)
  })

  it('strips a colon prefix as an extra candidate, not as the primary form', () => {
    const tt = normalise('I&E Basics : Introduction to Innovation and Entrepreneurship management ')
    const ex = normalise('Introduction to Innovation and Entrepreneurship Management')
    expect(tt.full).not.toBe(ex.full)
    expect(tt.candidates).toContain(ex.full)

    const hci = normalise('HCI Basics: Introduction and Design Methods')
    const hci2 = normalise('HCI: Introduction and Design Methods ')
    expect(hci.candidates[0]).toBe(hci2.candidates[0])
  })

  it('does NOT collapse I&E Study into the I&E Basics course', () => {
    const study = normalise('I&E Study')
    const basics = normalise('I&E Basics : Introduction to Innovation and Entrepreneurship management ')
    expect(study.full).not.toBe(basics.full)
    expect(study.candidates).toEqual([])
    expect(basics.candidates).not.toContain(study.full)
  })
})

describe('fuzzy score', () => {
  const pair = (a: string, b: string) => score(normalise(a), normalise(b))

  it('lifts single-character typos above the accept threshold', () => {
    // These all score lev ≈ 0.96 but would sit at ≈0.72 without fuzzy token
    // equality, because the typo'd token drops out of the intersection.
    for (const [a, b] of [
      ['Statisical Data Analysis', 'Statistical Data Analysis'],
      ['Open Data and Knowledege Graphs ', 'Open Data and Knowledge Graphs'],
      ['Software Poject Management', 'Software Project Management'],
      ['Tecnología Emergentes y Oportunidades de Negocio', 'Tecnologías Emergentes y Oportunidades de Negocio'],
      ['Devices and Biometric Aplications for e-Health', 'Devices and Biometric Applications for e-Health'],
      ['E-Health: promoting active and healthy aging', 'E-health: Promoting Active and Healthy Ageing'],
    ]) {
      expect(pair(a!, b!).total, `${a} ↔ ${b}`).toBeGreaterThanOrEqual(THRESHOLDS.acceptTotal)
    }
  })

  it('reaches the review band on the dropped Design suffix, via containment', () => {
    const s = pair('Cloud Computing and Big Data Ecosystems ', 'Cloud Computing and Big Data Ecosystems Design')
    expect(s.containment).toBe(1)
    expect(s.total).toBeGreaterThanOrEqual(THRESHOLDS.lowTotal)
    expect(s.total).toBeLessThan(THRESHOLDS.acceptTotal)
  })

  it('refuses the truncated HCID exam name — it needs a curated alias, not a guess', () => {
    // The HCID exam PDF really does omit `Intelligent Virtual `; a scorer should
    // not invent a two-word deletion.
    const s = pair(
      'Environments: Technologies, Architectures and Applications',
      'Intelligent Virtual Environments: Technologies, Architectures and Applications',
    )
    expect(s.containment).toBe(1)
    expect(s.total).toBeLessThan(THRESHOLDS.lowTotal)
  })

  it('keeps every known-distinct pair below the review band', () => {
    for (const [a, b] of [
      ['Data Analysis', 'Statistical Data Analysis'],
      ['Data Analysis', 'Intelligent Data Analysis'],
      ['Statistical Data Analysis', 'Intelligent Data Analysis'],
      ['I&E Study', 'Introduction to Innovation and Entrepreneurship Management'],
      ['Machine Learning', 'Massively Parallel Machine Learning'],
      ['Assistive Products', 'Accessible Design of Interactive Systems'],
      // Only a 1-character token differs here; the length guard on fuzzy token
      // equality is what keeps these two apart.
      ['Ethics for User Research 1', 'Ethics for User Research 2'],
    ]) {
      expect(pair(a!, b!).total, `${a} ↔ ${b}`).toBeLessThan(THRESHOLDS.lowTotal)
    }
  })
})

describe('bestMatch outcomes', () => {
  const pool = (names: string[]) => names.map((n) => ({ item: n, norm: normalise(n) }))

  it('accepts a typo against a realistic same-programme pool', () => {
    const r = bestMatch(normalise('Statisical Data Analysis'), pool([
      'Statistical Data Analysis', 'Intelligent Data Analysis', 'Data Analysis',
      'Data Processes', 'Machine Learning',
    ]))
    expect(r.kind).toBe('accept')
    if (r.kind === 'accept') {
      expect(r.item).toBe('Statistical Data Analysis')
      expect(r.confidence).toBe('high')
    }
  })

  it('refuses rather than guess between the three Data Analysis courses', () => {
    const r = bestMatch(normalise('Data Analysis'), pool([
      'Statistical Data Analysis', 'Intelligent Data Analysis', 'Data Processes',
    ]))
    expect(r.kind).toBe('none')
  })

  it('does not pull I&E Study onto the I&E Basics course', () => {
    const r = bestMatch(normalise('I&E Study'), pool([
      'I&E Basics : Introduction to Innovation and Entrepreneurship management ',
      'Data Processes',
    ]))
    expect(r.kind).toBe('none')
  })
})

describe('time parsing', () => {
  it('parses every header notation in the corpus', () => {
    expect(parseTimeRange('15:00-15:30')).toEqual({ startMin: 900, endMin: 930 })
    expect(parseTimeRange('15:00 - 15:30')).toEqual({ startMin: 900, endMin: 930 })
    expect(parseTimeRange('12:00 - 13:00')).toEqual({ startMin: 720, endMin: 780 })
    expect(parseTimeRange('10:00 to 13:00')).toEqual({ startMin: 600, endMin: 780 })
    expect(parseTimeRange('10:00  - 13:00')).toEqual({ startMin: 600, endMin: 780 })
    expect(parseTimeRange('10-12h.')).toEqual({ startMin: 600, endMin: 720 })
    expect(parseTimeRange('15:00 – 17:00')).toEqual({ startMin: 900, endMin: 1020 })
    expect(parseTimeRange('7:00 PM – 9:00 PM')).toEqual({ startMin: 1140, endMin: 1260 })
    expect(parseTimeRange('not a range')).toBeNull()
  })

  it('parses weekday names in both languages', () => {
    expect(parseWeekday('Lunes')).toBe(1)
    expect(parseWeekday('MIÉRCOLES')).toBe(3)
    expect(parseWeekday('MIERCOLES')).toBe(3)
    expect(parseWeekday('Wednesday  ')).toBe(3)
    expect(parseWeekday('Aula 6202')).toBeNull()
  })

  it('verifies the weekday word against the resulting date', () => {
    expect(parseExamDate('MONDAY 11')).toBe('2027-01-11')
    expect(parseExamDate('Miércoles  20')).toBe('2027-01-20')
    expect(parseExamDate('Jueves 14')).toBe('2027-01-14')
    expect(parseExamDate('12-January')).toBe('2027-01-12')
    // 13 January 2027 is a Wednesday, so a header claiming Monday is a mapping bug.
    expect(parseExamDate('MONDAY 13')).toBeNull()
  })

  it('anchors validity labels', () => {
    expect(resolveValidity('sep-oct')).toEqual({ from: '2026-09-01', to: '2026-10-31' })
    expect(resolveValidity('nov-ene')).toEqual({ from: '2026-11-01', to: '2027-01-31' })
    expect(resolveValidity('Weeks 1-7')?.from).toBe('2026-09-07')
    expect(resolveValidity('whenever')).toBeNull()
  })
})

describe('room extraction and filler classification', () => {
  it('matches whole-line room notations only', () => {
    const mk = (texts: string[]): Line[] =>
      texts.map((text, k) => [{ i: k, x: 100, y: 500 - k * 10, w: 60, h: 9, text, font: 'f', size: 9 }])
    expect(extractRoom({
      ...blockOf(mk(['Big Data / Data Visualization', 'Room 5001'])),
    })).toBe('5001')
    expect(extractRoom(blockOf(mk(['Intelligent Data Analysis', 'Aulas 5001-5005'])))).toBe('5001-5005')
    expect(extractRoom(blockOf(mk(['Sistemas Empotrados y Ubicuos', 'Aula  6202'])))).toBe('6202')
    expect(extractRoom(blockOf(mk(['Computer Security', '[IMDEA]'])))).toBe('IMDEA')
    expect(extractRoom(blockOf(mk(['Machine Learning', '(Classroom 3203)'])))).toBe('3203')
    // A digit inside a course name must not be eaten.
    expect(extractRoom(blockOf(mk(['21st Century Challenges for Software Engineering'])))).toBeNull()
  })

  it('assembles a wrapped name without the room line', () => {
    const mk = (texts: string[]): Line[] =>
      texts.map((text, k) => [{ i: k, x: 100, y: 500 - k * 10, w: 60, h: 9, text, font: 'f', size: 9 }])
    const b = blockOf(mk(['Cloud Computing and Big Data ', 'Ecosystems Design', 'Room 5001']))
    expect(assembleName(b)).toBe('Cloud Computing and Big Data Ecosystems Design')
  })

  it('classifies filler blocks but not real courses', () => {
    expect(classifyBlock('Actividades de evaluación y de uso extraordinario')).toBe('filler')
    expect(classifyBlock('To be used sporadically in complementary /evaluation activities')).toBe('filler')
    expect(classifyBlock('//////')).toBe('filler')
    expect(classifyBlock('Scientific Research and Advanced Topics')).toBe('course')
    expect(classifyBlock('Data Processes')).toBe('course')
  })
})

describe('slugFor', () => {
  it('is stable across NFC/NFD filename encodings and deaccents', () => {
    const nfc = 'timetables/Timetable 26_27 - Máster Universitario en Ciencia de Datos.pdf'
    expect(slugFor(nfc.normalize('NFD'))).toBe(slugFor(nfc.normalize('NFC')))
    expect(slugFor(nfc)).toBe(
      'timetables--timetable-26-27--master-universitario-en-ciencia-de-datos',
    )
  })
})

function blockOf(lines: Line[]) {
  return blocksInBand(lines, { y0: 0, y1: 1000 }, { minGapPt: 12 })[0]!
}
