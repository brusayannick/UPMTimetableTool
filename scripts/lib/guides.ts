/**
 * UPM learning-guide URLs, reverse-engineered and verified.
 *
 * Pattern (confirmed by probing, September 2026):
 *   https://www.upm.es/comun_gauss/publico/guias/{YEAR}/GA_{PLAN}_{CODE}_{LANG}_{YEAR}.pdf
 * e.g. `.../2026-27/GA_10BA_103000892_EN_2026-27.pdf`.
 *
 * Two things probing proved that guessing would get wrong:
 *  - language availability varies per course (some have EN only, some ES only,
 *    some both), so every PLAN × CODE × LANG variant is checked with an HTTP
 *    HEAD rather than assumed;
 *  - the CSV `Plans`/`Codes` cells are parallel lists, so pairs are positional.
 *
 * `scripts/fetch-guides.ts` does the probing and writes
 * `data/curation/guides.json` (verified URLs only — committed, reviewable).
 * `export-bundle.ts` fills each catalogue row's `learningGuide` from that set,
 * so the build itself stays offline and hermetic.
 */

export const GUIDE_YEAR = '2026-27'
const GUIDE_BASE = 'https://www.upm.es/comun_gauss/publico/guias'
const GUIDE_LANGS = ['EN', 'ES'] as const

export type GuideLang = (typeof GUIDE_LANGS)[number]

export function guideUrl(plan: string, code: string, lang: GuideLang, year: string = GUIDE_YEAR): string {
  return `${GUIDE_BASE}/${year}/GA_${plan}_${code}_${lang}_${year}.pdf`
}

/** Positional PLAN × CODE pairs from the parallel CSV list cells. */
export function planCodePairs(plans: string, codes: string): { plan: string; code: string }[] {
  const ps = plans.split(',').map((s) => s.trim()).filter(Boolean)
  const cs = codes.split(',').map((s) => s.trim()).filter(Boolean)
  const out = new Map<string, { plan: string; code: string }>()
  for (let i = 0; i < Math.min(ps.length, cs.length); i++) {
    const plan = ps[i]!
    const code = cs[i]!
    if (!/^\d+$/.test(code)) continue
    out.set(`${plan}|${code}`, { plan, code })
  }
  return [...out.values()]
}

/** Every candidate guide URL for a catalogue row (both languages each). */
export function candidateGuideUrls(
  plans: string,
  codes: string,
  year: string = GUIDE_YEAR,
): string[] {
  return planCodePairs(plans, codes).flatMap(({ plan, code }) =>
    GUIDE_LANGS.map((lang) => guideUrl(plan, code, lang, year)),
  )
}

export function loadVerifiedGuides(readFile: (path: string) => string, path: string): Set<string> {
  try {
    const data = JSON.parse(readFile(path)) as { verified?: string[] }
    return new Set(data.verified ?? [])
  } catch {
    return new Set()
  }
}
