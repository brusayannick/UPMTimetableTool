/**
 * Tests for the web-printed timetable parsers (T5, T6), run against the
 * committed extraction JSONs — never against a PDF.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadExtraction } from '../lib/curation.ts'
import { EXTRACTED_DIR } from '../lib/paths.ts'
import type { PdfExtraction } from '../lib/types.ts'
import { parseDayColumnGrid, parseWebList } from './weblist.ts'

const load = (slug: string): PdfExtraction =>
  JSON.parse(readFileSync(join(EXTRACTED_DIR, `${slug}.json`), 'utf8')) as PdfExtraction

const MUCD = 'timetables--timetable-26-27--master-universitario-en-ciencia-de-datos'
const MUIA = 'timetables--timetable--master-s-degree-in-artificial-intelligence'

const mucdSpec = {
  path: 'timetables/Timetable 26_27 - Máster Universitario en Ciencia de Datos.pdf',
  kind: 'timetable' as const,
  layoutFamily: 'T5' as const,
  programme: '10BA',
  semester: '1S' as const,
  role: 'primary' as const,
  pages: [0],
}

const muiaSpec = {
  path: "timetables/Timetable - Master's Degree in Artificial Intelligence.pdf",
  kind: 'timetable' as const,
  layoutFamily: 'T6' as const,
  programme: 'MUIA',
  semester: '1S' as const,
  role: 'primary' as const,
  pages: [0],
  roomDefault: '6201',
}

describe('parseWebList (T5)', () => {
  it('reads the MUCD elective table: entries, rooms and filler', () => {
    const parsed = parseWebList(loadExtraction(MUCD), mucdSpec)
    expect(parsed.sessions.length).toBe(8)
    expect(parsed.fillerCount).toBe(3)
    expect(parsed.diagnostics.filter((d) => d.severity === 'error')).toEqual([])

    const monday = parsed.sessions.filter((s) => s.weekday === 1)
    expect(monday.map((s) => [s.startMin, s.endMin, s.room, s.rawName])).toEqual([
      [960, 1080, '5001', 'Data Processes'],
      [1080, 1260, '5001', 'Data Visualization/Big Data'],
    ])
    expect(monday[0]!.spanSource).toBe('explicit')

    const friday = parsed.sessions.filter((s) => s.weekday === 5)
    expect(friday.length).toBe(1)
    expect(friday[0]!.rawName).toBe('Open Data and Knowledge Graphs')
  })
})

describe('parseDayColumnGrid (T6)', () => {
  it('reads the MUIA subject grid without leaking the notes below it', () => {
    const parsed = parseDayColumnGrid(load(MUIA), muiaSpec)
    expect(parsed.sessions.length).toBe(25)
    expect(parsed.fillerCount).toBe(0)
    expect(parsed.diagnostics.filter((d) => d.severity !== 'info')).toEqual([])

    // Runs arrive without spacing.
    const mon9 = parsed.sessions.find((s) => s.weekday === 1 && s.startMin === 540)!
    expect(mon9.rawName).toBe('A7: Explainable Artificial Intelligence')

    // The 12-hour evening row parses to 19:00–21:00.
    const mon19 = parsed.sessions.find((s) => s.weekday === 1 && s.startMin === 1140)!
    expect(mon19.endMin).toBe(1260)
    expect(mon19.rawName).toBe('A10: Programmable Biology: DNA Computing and Biocircuit Engineering')

    // The last row keeps its cell; the concentrated-format note below is excluded.
    const wed19 = parsed.sessions.find((s) => s.weekday === 3 && s.startMin === 1140)!
    expect(wed19.rawName).toBe('A19: Web Science')

    // The grid title gives one room for the whole timetable.
    expect(parsed.sessions.every((s) => s.room === '6201')).toBe(true)

    // The lunch row is empty.
    expect(parsed.sessions.some((s) => s.startMin === 840)).toBe(false)
  })
})
