import type { Programme, Weekday } from '../data/types.ts'

export const fmtMin = (min: number): string =>
  `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`

export const fmtRange = (s: number, e: number, assumed = false): string =>
  `${fmtMin(s)}–${assumed ? '~' : ''}${fmtMin(e)}`

export const WEEKDAYS: { n: Weekday; label: string; short: string }[] = [
  { n: 1, label: 'Monday', short: 'Mon' },
  { n: 2, label: 'Tuesday', short: 'Tue' },
  { n: 3, label: 'Wednesday', short: 'Wed' },
  { n: 4, label: 'Thursday', short: 'Thu' },
  { n: 5, label: 'Friday', short: 'Fri' },
]

let palette: Record<string, string> = {}

export const setPalette = (programmes: Programme[]): void => {
  palette = Object.fromEntries(programmes.map((p) => [p.code, p.colour]))
}

export const progColour = (code: string): string => palette[code] ?? 'var(--text-faint)'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** `2026-01-14` → `Wed 14 Jan`. Parsed as UTC so the label never shifts by a day. */
export function fmtDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()]!
  return `${wd} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`
}

export const fmtDateShort = (iso: string): string => {
  const d = new Date(`${iso}T00:00:00Z`)
  return `${d.getUTCDate()}`
}

export const weekdayOf = (iso: string): number => new Date(`${iso}T00:00:00Z`).getUTCDay()

/** Every weekday between two ISO dates, inclusive — the exam-panel columns. */
export function weekdaysBetween(from: string, to: string): string[] {
  const out: string[] = []
  const d = new Date(`${from}T00:00:00Z`)
  const end = new Date(`${to}T00:00:00Z`)
  while (d <= end) {
    const day = d.getUTCDay()
    if (day >= 1 && day <= 5) out.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}
