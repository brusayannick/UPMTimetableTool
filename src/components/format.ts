import type { Programme, Weekday } from '../data/types.ts'

export const fmtMin = (min: number): string =>
  `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`

/**
 * Sum ECTS from catalogue detail rows (`credits` prints with a comma decimal,
 * e.g. `4,5`). Rows are grouped by catalogue identity (Spanish + English
 * name): one offering counts once even when several plans list it, and
 * distinct offerings (e.g. the two 3-credit halves of Big Data) add up.
 * Returns null when nothing usable is stated — or when one offering states
 * conflicting credits, which the build refuses to guess at — so callers can
 * say the total is partial rather than silently wrong.
 */
export function creditsOfDetails(
  rows: { credits: string; name: string; englishName: string }[] | undefined,
): number | null {
  if (!rows || rows.length === 0) return null
  const byOffering = new Map<string, Set<number>>()
  for (const r of rows) {
    const v = parseFloat(r.credits.replace(',', '.'))
    if (Number.isNaN(v)) continue
    const key = `${r.name}|${r.englishName}`.toLowerCase().replace(/\s+/g, ' ').trim()
    const set = byOffering.get(key)
    if (set) set.add(v)
    else byOffering.set(key, new Set([v]))
  }
  if (byOffering.size === 0) return null
  let total = 0
  for (const values of byOffering.values()) {
    if (values.size !== 1) return null
    total += [...values][0]!
  }
  return total
}

/**
 * A learning-guide URL (`…/GA_10BA_103000892_EN_2026-27.pdf`) as a readable
 * label: the guide language plus the plan it belongs to. Null when the URL is
 * not a guide link, so callers can fall back to the raw URL.
 */
export function guideLinkLabel(url: string): { language: string; plan: string } | null {
  const m = /GA_([^_/]+)_\d+_(EN|ES)_/.exec(url)
  if (!m) return null
  return { language: m[2] === 'EN' ? 'English' : 'Spanish', plan: m[1]! }
}

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
