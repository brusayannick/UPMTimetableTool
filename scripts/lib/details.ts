/**
 * Joining bundle courses to the incoming-student catalogue CSV
 * (`timetables/Application_ETSIINF_Courses_Incoming_Student_unprotected.csv`).
 *
 * The CSV is semicolon-delimited UTF-8 with a BOM, one row per plan course.
 * Matching is deliberately strict — normalised equality on the Spanish `Name`
 * or the `English name` cell, plus the `A<digits>:` timetable-code strip for
 * MUIA courses — with the residue in `data/curation/details.json`. Anything
 * the join cannot place (a course with no catalogue row, a stale curated
 * entry) is reported, never silently dropped or invented.
 */

import { readFileSync } from 'node:fs'
import { CURATION_DIR } from './paths.ts'
import { normalise } from './normalize.ts'

export type CatalogueRow = {
  plans: string
  codes: string
  name: string
  englishName: string
  year: string
  credits: string
  language: string
  semester: string
  group: string
  level: string
  quota: string
  learningGuide: string
  observations: string
}

export type DetailMatch = {
  /** Bundle courses (by canonical key) left without a catalogue row. */
  unmatchedCourses: string[]
  /** Curated entries that matched nothing — stale mappings. */
  unusedExtras: string[]
  /** Courses matching more than one row (e.g. taught in two plans). */
  multiRowCourses: string[]
}

const keyOf = (s: string): string => normalise(s).key

function clean(cell: string): string {
  const t = cell.trim()
  return t === '' || t === '#REF!' ? '' : t
}

function splitRows(text: string): string[][] {
  // Minimal semicolon-CSV: handles quoted cells with embedded newlines and
  // doubled quotes. No external dependency for one file.
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  const src = text.replace(/^\uFEFF/, '')
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"'
          i++
        } else {
          quoted = false
        }
      } else {
        cell += ch
      }
    } else if (ch === '"') {
      quoted = true
    } else if (ch === ';') {
      row.push(cell)
      cell = ''
    } else if (ch === '\n') {
      row.push(cell)
      cell = ''
      rows.push(row)
      row = []
    } else if (ch === '\r') {
      // CRLF: the \n arrives next.
    } else {
      cell += ch
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

export function parseCatalogue(csv: string): CatalogueRow[] {
  const rows = splitRows(csv)
  if (rows.length === 0) return []
  const header = rows[0]!.map((h) => h.trim().toLowerCase())
  const col = (name: string): number => header.indexOf(name)
  const at = (r: string[], name: string): string => {
    const i = col(name)
    return i < 0 ? '' : (r[i] ?? '')
  }
  return rows.slice(1).map((r) => ({
    plans: clean(at(r, 'plans')),
    codes: clean(at(r, 'codes')),
    name: clean(at(r, 'name')),
    englishName: clean(at(r, 'english name')),
    year: clean(at(r, 'year')),
    credits: clean(at(r, 'credits')),
    language: clean(at(r, 'language')),
    semester: clean(at(r, 'semester')),
    group: clean(at(r, 'group')),
    level: clean(at(r, 'level')),
    quota: clean(at(r, 'quota')),
    learningGuide: clean(at(r, 'learning guide')),
    observations: clean(at(r, 'observations')),
  }))
}

export function loadCatalogue(path: string): CatalogueRow[] {
  return parseCatalogue(readFileSync(path, 'utf8'))
}

export function loadDetailExtras(): Record<string, string[]> {
  return (JSON.parse(readFileSync(CURATION_DIR + '/details.json', 'utf8')) as { extraMatches: Record<string, string[]> }).extraMatches ?? {}
}

/**
 * Match bundle courses (by canonical key + display name) to catalogue rows.
 * Returns the details per course key plus a report of everything unplaced.
 */
export function matchDetails(
  courses: { key: string; name: string }[],
  rows: CatalogueRow[],
  extras: Record<string, string[]>,
): { byKey: Map<string, CatalogueRow[]>; report: DetailMatch } {
  const byNameKey = new Map<string, CatalogueRow[]>()
  for (const r of rows) {
    for (const cell of [r.name, r.englishName]) {
      if (!cell) continue
      const k = keyOf(cell)
      const list = byNameKey.get(k)
      if (list) list.push(r)
      else byNameKey.set(k, [r])
    }
  }

  const extraKeys = new Map<string, string[]>()
  for (const [display, cells] of Object.entries(extras)) {
    extraKeys.set(keyOf(display), cells.map(keyOf))
  }

  const byKey = new Map<string, CatalogueRow[]>()
  const unmatchedCourses: string[] = []
  const multiRowCourses: string[] = []
  const usedExtras = new Set<string>()

  for (const c of courses) {
    const seen = new Map<string, CatalogueRow>()
    const take = (k: string): void => {
      for (const r of byNameKey.get(k) ?? []) {
        const id = `${r.plans}|${r.codes}|${r.name}|${r.englishName}`
        if (!seen.has(id)) seen.set(id, r)
      }
    }
    take(c.key)
    take(keyOf(c.name.replace(/^A\d+\s*:\s*/i, '')))
    for (const k of extraKeys.get(c.key) ?? []) {
      if ((byNameKey.get(k) ?? []).length > 0) usedExtras.add(`${c.key}→${k}`)
      take(k)
    }
    const matched = [...seen.values()]
    if (matched.length === 0) {
      unmatchedCourses.push(c.name)
    } else {
      byKey.set(c.key, matched)
      if (matched.length > 1) multiRowCourses.push(c.name)
    }
  }

  const unusedExtras: string[] = []
  for (const [display, cells] of Object.entries(extras)) {
    const courseKey = keyOf(display)
    for (const cell of cells) {
      const k = keyOf(cell)
      if (!usedExtras.has(`${courseKey}→${k}`)) unusedExtras.push(`${display} → ${cell}`)
    }
  }

  return { byKey, report: { unmatchedCourses, unusedExtras, multiRowCourses } }
}
