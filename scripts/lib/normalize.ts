/**
 * Course-name normalisation.
 *
 * Course names do not match verbatim between a programme's timetable PDF and its
 * exam PDF. Observed mismatch classes, all of which this module is built to
 * absorb: case-only differences, trailing and internal double spaces, missing
 * accents, `&` vs `and`, a dropped comma, `E-Health` / `eHealth` / `E-health`,
 * `Service-Oriented` / `Service Oriented`, and stripped `HCI Basics:` / `I&E
 * Basics :` prefixes. Single-character typos are *not* handled here — those go
 * through the fuzzy scorer, and the residue through a curated alias file.
 */

import { stripAnnotations } from './geometry.ts'

/** Words that carry no identity, so token-set comparison ignores them. */
const STOPWORDS = new Set([
  'de', 'del', 'la', 'el', 'y', 'en', 'los', 'las',
  'of', 'the', 'and', 'for', 'in', 'to', 'a',
])

/**
 * Prefixes that one side of a pair prints and the other drops, e.g. the timetable
 * `I&E Basics : Introduction to Innovation and Entrepreneurship management`
 * against the exam `Introduction to Innovation and Entrepreneurship Management`.
 *
 * A prefix only strips when the source printed a colon after it. That is what
 * keeps `I&E Study` intact — it is a separate course with its own exam, and
 * collapsing it would silently merge two real courses.
 */
const STRIPPABLE_PREFIXES = ['i and e basics', 'hci basics', 'hci']

/** Applied after hyphens become spaces, to collapse spelling variants. */
const DEFAULT_EQUIVALENCES: [string, string][] = [
  ['e health', 'ehealth'],
  ['e mail', 'email'],
]

export type Normalised = {
  /** Fully normalised single-line form. */
  full: string
  /** Identity tokens, stopwords removed. */
  tokensCore: string[]
  /** `full` with spaces as hyphens — the database `canonical_key`. */
  key: string
  /** Alternative forms to also try when joining (currently prefix-stripped). */
  candidates: string[]
}

const deaccent = (s: string): string => s.normalize('NFD').replace(/\p{Mn}/gu, '').normalize('NFC')

export function normalise(raw: string, equivalences: [string, string][] = DEFAULT_EQUIVALENCES): Normalised {
  // 1. compatibility-decompose so full-width and ligature forms unify
  let s = raw.normalize('NFKC')

  // 2. unify dash and quote variants
  s = s.replace(/[–—‐‑‒]/g, '-').replace(/[‘’]/g, "'")

  // 3. defensively re-run annotation stripping (parsers already did this, but a
  //    curated alias string may still carry one)
  s = stripAnnotations(s).name

  // 4-5. case and accents
  s = deaccent(s.toLowerCase())

  // 6. `&` is spelled out in some files and symbolic in others
  s = s.replace(/&/g, ' and ')

  // 7. hyphens become spaces (never deleted — that is what bridges
  //    `Service-Oriented` and `Service Oriented`), then targeted equivalences
  s = s.replace(/-/g, ' ').replace(/\s+/g, ' ').trim()
  for (const [from, to] of equivalences) {
    s = s.replaceAll(from, to)
  }

  // 11a. detect a strippable prefix while the colon is still present
  const withColon = s
  const prefixRest = (() => {
    for (const prefix of STRIPPABLE_PREFIXES) {
      const re = new RegExp(`^${prefix}\\s*:\\s*(.+)$`)
      const m = re.exec(withColon)
      if (m) return m[1]!
    }
    return null
  })()

  // 8. drop remaining punctuation
  const drop = (t: string): string => t.replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim()

  // 9. collapse
  const full = drop(s)

  // 10. identity tokens
  const tokensCore = full.split(' ').filter((t) => t !== '' && !STOPWORDS.has(t))

  // 11b. prefix-stripped alternative
  const candidates: string[] = []
  if (prefixRest !== null) {
    const rest = drop(prefixRest)
    if (rest !== '' && rest !== full) candidates.push(rest)
  }

  return { full, tokensCore, key: full.replaceAll(' ', '-'), candidates }
}

/** Convenience: the canonical key for a raw printed name. */
export const canonicalKey = (raw: string): string => normalise(raw).key
