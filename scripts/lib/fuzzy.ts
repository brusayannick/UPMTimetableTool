/**
 * Fuzzy course-name scoring.
 *
 * Hand-rolled rather than pulled from a library because plain edit distance alone
 * puts the real corpus cases in the wrong bands. Two terms beyond Levenshtein
 * earn their place, both calibrated against measured scores on real pairs:
 *
 *  - **Containment.** The HMDA files print `Cloud Computing and Big Data
 *    Ecosystems` where DSC and MUII print `… Design`. Containment is 1.00 there
 *    and lifts the pair to 0.84 — inside the review band. Levenshtein alone would
 *    leave dropped-suffix pairs looking like different courses.
 *  - **Fuzzy token equality.** A single-character typo is the most common defect
 *    in these PDFs (`Statisical`, `Knowledege`, `Poject`, `Aplications`,
 *    `Tecnología`, `aging`/`Ageing`). Such a pair scores `lev` ≈ 0.96 — but the
 *    typo'd token drops out of the token intersection entirely, dragging
 *    `tokenSet` to 0.50 and the total to 0.72, i.e. into the reject band. Treating
 *    two tokens as equal when they are within one edit *and* at least 5 characters
 *    long fixes that, and measurably does not blur real distinctions: `Ethics for
 *    User Research 1` vs `… 2` differ only in a 1-character token and stay at
 *    0.77, and the three real `… Data Analysis` courses stay ≤ 0.65.
 *
 * Names the scorer deliberately does *not* rescue: the HCID exam PDF genuinely
 * prints `Environments: Technologies, Architectures and Applications` with
 * `Intelligent Virtual ` absent from the content stream. That scores 0.75 and is a
 * curated alias — inventing a match from a two-word deletion is not something a
 * scorer should be trusted to do.
 */

import type { Normalised } from './normalize.ts'

export type Score = {
  total: number
  lev: number
  tokenSet: number
  containment: number
  prefix: number
}

/** Two-row DP. Names here are under 90 characters. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  let cur = new Array<number>(b.length + 1)
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost)
    }
    const swap = prev
    prev = cur
    cur = swap
  }
  return prev[b.length]!
}

/** Minimum token length for one-edit tolerance. Below this, `1` vs `2` would match. */
const FUZZY_TOKEN_MIN_LEN = 5

const tokensEqual = (a: string, b: string): boolean =>
  a === b ||
  (Math.min(a.length, b.length) >= FUZZY_TOKEN_MIN_LEN &&
    Math.abs(a.length - b.length) <= 1 &&
    levenshtein(a, b) <= 1)

/** Greedy one-to-one matching between two token sets under `tokensEqual`. */
function intersectFuzzy(a: string[], b: string[]): number {
  const used = new Array<boolean>(b.length).fill(false)
  let n = 0
  // Exact matches first so a fuzzy match cannot steal an exact partner.
  for (const pass of [true, false]) {
    for (const ta of a) {
      for (let j = 0; j < b.length; j++) {
        if (used[j]) continue
        const eq = pass ? ta === b[j] : tokensEqual(ta, b[j]!)
        if (eq) {
          used[j] = true
          n++
          break
        }
      }
    }
    if (n === Math.min(a.length, b.length)) break
  }
  return n
}

export function score(a: Normalised, b: Normalised): Score {
  const maxLen = Math.max(a.full.length, b.full.length) || 1
  const lev = 1 - levenshtein(a.full, b.full) / maxLen

  const tokA = [...new Set(a.tokensCore)]
  const tokB = [...new Set(b.tokensCore)]
  const inter = intersectFuzzy(tokA, tokB)
  const union = tokA.length + tokB.length - inter
  const tokenSet = union === 0 ? 0 : inter / union
  const minSize = Math.min(tokA.length, tokB.length)
  const containment = minSize === 0 ? 0 : inter / minSize

  // Either side's prefix-stripped form equalling the other's full form.
  const prefix =
    a.candidates.includes(b.full) || b.candidates.includes(a.full) ||
    a.candidates.some((c) => b.candidates.includes(c))
      ? 1
      : 0

  const total = 0.45 * lev + 0.25 * tokenSet + 0.25 * containment + 0.05 * prefix
  return { total, lev, tokenSet, containment, prefix }
}

export type Candidate<T> = { item: T; norm: Normalised }

export type MatchOutcome<T> =
  | { kind: 'accept'; item: T; score: Score; margin: number; confidence: 'high' | 'low' }
  | { kind: 'ambiguous'; best: T; runnerUp: T; score: Score; margin: number }
  | { kind: 'none'; best: T | null; score: Score | null }

export const THRESHOLDS = {
  acceptTotal: 0.93,
  acceptMargin: 0.06,
  lowTotal: 0.8,
  lowMargin: 0.12,
  lowContainment: 0.85,
} as const

/**
 * Pick the best candidate, or refuse.
 *
 * The ambiguous band is not a theoretical guard — it fires on `Data Analysis` vs
 * `Statistical Data Analysis` vs `Intelligent Data Analysis`, which are three
 * distinct real courses. Refusing there and demanding a curated alias is the
 * point; guessing would put a student in the wrong exam.
 */
export function bestMatch<T>(target: Normalised, pool: Candidate<T>[]): MatchOutcome<T> {
  if (pool.length === 0) return { kind: 'none', best: null, score: null }

  const scored = pool
    .map((c) => ({ c, s: score(target, c.norm) }))
    .sort((x, y) => y.s.total - x.s.total)

  const top = scored[0]!
  const second = scored[1]
  const margin = second ? top.s.total - second.s.total : Infinity

  if (top.s.total >= THRESHOLDS.acceptTotal && margin >= THRESHOLDS.acceptMargin) {
    return { kind: 'accept', item: top.c.item, score: top.s, margin, confidence: 'high' }
  }
  if (top.s.total >= THRESHOLDS.lowTotal) {
    if (margin < THRESHOLDS.lowMargin) {
      return second
        ? { kind: 'ambiguous', best: top.c.item, runnerUp: second.c.item, score: top.s, margin }
        : { kind: 'accept', item: top.c.item, score: top.s, margin, confidence: 'low' }
    }
    if (top.s.containment >= THRESHOLDS.lowContainment) {
      return { kind: 'accept', item: top.c.item, score: top.s, margin, confidence: 'low' }
    }
  }
  return { kind: 'none', best: top.c.item, score: top.s }
}
