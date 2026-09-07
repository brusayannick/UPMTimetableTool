/**
 * Times are integer minutes since midnight throughout the pipeline and the app.
 * Dates are ISO `YYYY-MM-DD` strings. No date library.
 */

import type { Semester, Weekday } from './types.ts'

/** The corpus contains 30-minute boundaries but no 15-minute ones. */
export const GRANULARITY = 30

export class TimeParseError extends Error {}
export class GranularityError extends Error {}

export const toMin = (h: number, m: number): number => h * 60 + m

export function fmtMin(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** `9:00`, `09:00`, `12:00 h.`, `18h`, `7:00 PM` → minutes. Returns null if not a time. */
export function parseTime(raw: string): number | null {
  const s = raw.trim()
  let m = /^(\d{1,2})[:.](\d{2})\s*([ap])\.?m?\.?$/i.exec(s)
  if (m) {
    let h = Number(m[1]) % 12
    if (m[3]!.toLowerCase() === 'p') h += 12
    return toMin(h, Number(m[2]))
  }
  m = /^(\d{1,2})[:.](\d{2})\s*(?:h\.?)?$/.exec(s)
  if (m) return toMin(Number(m[1]), Number(m[2]))
  m = /^(\d{1,2})\s*h\.?$/.exec(s)
  if (m) return toMin(Number(m[1]), 0)
  return null
}

/**
 * Parse a printed time-range header cell.
 *
 * Handles every notation observed in the corpus:
 *   `15:00-15:30`  `15:00 - 15:30`  `12:00 - 13:00`  (timetable headers)
 *   `10:00 to 13:00`  `10:00  - 13:00`               (exam slot labels)
 *   `10-12h.`                                        (HCID inline duration)
 *   `15:00-16:30`                                    (Fintech inline override)
 *   `7:00 PM – 9:00 PM`                              (MUIA evening row)
 */
export function parseTimeRange(raw: string): { startMin: number; endMin: number } | null {
  const s = raw.replace(/ /g, ' ').trim()
  const m = /^(\d{1,2}(?:[:.]\d{2})?\s*(?:[ap]\.?m?\.?)?)\s*(?:-|–|—|to)\s*(\d{1,2}(?:[:.]\d{2})?\s*(?:[ap]\.?m?\.?)?)\s*(?:h\.?)?$/i.exec(s)
  if (!m) return null
  const a = parseTime(m[1]!) ?? parseTime(`${m[1]}:00`)
  const b = parseTime(m[2]!) ?? parseTime(`${m[2]}:00`)
  if (a === null || b === null || b <= a) return null
  return { startMin: a, endMin: b }
}

/** Throws unless `min` sits on a 30-minute boundary. */
export function assertGranularity(min: number, where: string): void {
  if (min % GRANULARITY !== 0) {
    throw new GranularityError(`${where}: ${fmtMin(min)} (${min}) is not on a ${GRANULARITY}-minute boundary`)
  }
}

// ── weekdays ────────────────────────────────────────────────────────────────

const WEEKDAYS: Record<string, Weekday> = {
  monday: 1, lunes: 1,
  tuesday: 2, martes: 2,
  wednesday: 3, miercoles: 3,
  thursday: 4, jueves: 4,
  friday: 5, viernes: 5,
}

const deaccent = (s: string): string => s.normalize('NFD').replace(/\p{Mn}/gu, '')

/** `Lunes`, `MIÉRCOLES`, `Wednesday  ` → 1..5. Null if not a weekday name. */
export function parseWeekday(raw: string): Weekday | null {
  const key = deaccent(raw.trim().toLowerCase()).replace(/[^a-z]/g, '')
  return WEEKDAYS[key] ?? null
}

export const WEEKDAY_LABELS: Record<Weekday, string> = {
  1: 'Monday', 2: 'Tuesday', 3: 'Wednesday', 4: 'Thursday', 5: 'Friday',
}

// ── exam dates ──────────────────────────────────────────────────────────────

/** The January 2027 exam period. All exam PDFs live inside this window. */
export const EXAM_YEAR = 2027
export const EXAM_MONTH = 1
export const EXAM_WINDOW = { from: '2027-01-11', to: '2027-01-22' } as const

const MONTHS: Record<string, number> = {
  january: 1, enero: 1, february: 2, febrero: 2,
}

/**
 * Parse a printed exam date-column header into an ISO date.
 *
 * Handles `MONDAY 12`, `Monday 12`, `LUNES 12`, `MIÉRCOLES 14`, `Miércoles  21`,
 * `12-January`, `Jueves 8`. The weekday word is *verified* against the resulting
 * date rather than ignored — a header that says Monday but lands on a Tuesday
 * means the column mapping is wrong, and that must not pass silently.
 */
export function parseExamDate(raw: string, opts: { month?: number } = {}): string | null {
  const s = raw.replace(/ /g, ' ').trim()

  // `12-January` / `12 January`
  let m = /^(\d{1,2})\s*[-\s]\s*([A-Za-z]+)$/.exec(s)
  if (m) {
    const month = MONTHS[m[2]!.toLowerCase()]
    if (!month) return null
    return isoDate(EXAM_YEAR, month, Number(m[1]))
  }

  // `MONDAY 12` / `Miércoles  21`
  m = /^([A-Za-zÀ-ÿ]+)\s+(\d{1,2})$/.exec(s)
  if (m) {
    const wd = parseWeekday(m[1]!)
    if (wd === null) return null
    const month = opts.month ?? EXAM_MONTH
    const iso = isoDate(EXAM_YEAR, month, Number(m[2]))
    const actual = new Date(`${iso}T00:00:00Z`).getUTCDay()
    if (actual !== wd) return null
    return iso
  }

  return null
}

export const isoDate = (y: number, m: number, d: number): string =>
  `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`

// ── date-range validity (`sep-oct`, `nov-ene`, `Weeks 1-7`) ──────────────────

/** Academic-year anchors for the 2026-27 first semester. */
const TERM_START = '2026-09-07'
const TERM_END = '2027-01-08'

const MONTH_ANCHORS: Record<string, { from: string; to: string }> = {
  sep: { from: '2026-09-01', to: '2026-09-30' },
  oct: { from: '2026-10-01', to: '2026-10-31' },
  nov: { from: '2026-11-01', to: '2026-11-30' },
  dic: { from: '2026-12-01', to: '2026-12-31' },
  dec: { from: '2026-12-01', to: '2026-12-31' },
  ene: { from: '2027-01-01', to: '2027-01-31' },
  jan: { from: '2027-01-01', to: '2027-01-31' },
}

/**
 * `sep-oct` → 2025-09-01…2025-10-31. `Weeks 1-7` → the first 7 teaching weeks.
 * Returns null for labels we cannot anchor, so the caller can warn instead of
 * inventing a range.
 */
export function resolveValidity(label: string): { from: string; to: string } | null {
  const s = label.trim().toLowerCase()

  const weeks = /^weeks?\s+(\d{1,2})\s*-\s*(\d{1,2})$/.exec(s)
  if (weeks) {
    const from = addDays(TERM_START, (Number(weeks[1]) - 1) * 7)
    const to = addDays(TERM_START, Number(weeks[2]) * 7 - 1)
    return { from, to: to > TERM_END ? TERM_END : to }
  }

  const months = /^([a-z]{3})\s*-\s*([a-z]{3})$/.exec(s)
  if (months) {
    const a = MONTH_ANCHORS[months[1]!]
    const b = MONTH_ANCHORS[months[2]!]
    if (a && b) return { from: a.from, to: b.to }
  }

  return null
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Two sessions can only collide if their validity windows overlap. */
export function rangesOverlap(
  a: { from: string; to: string } | null,
  b: { from: string; to: string } | null,
): boolean {
  if (!a || !b) return true
  return a.from <= b.to && b.from <= a.to
}

export const SEMESTERS: readonly Semester[] = ['1S', '3S']
