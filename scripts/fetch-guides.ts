/**
 * Verify learning-guide URLs against www.upm.es and curate the working ones.
 *
 * Scope is exactly the catalogue rows shown in the app (the ones matched to
 * bundle courses), so an unrelated catalogue row never costs a request. Writes
 * `data/curation/guides.json` — verified URLs only, committed for review.
 *
 *   npm run guides
 *
 * Exit status: 0 when every probe answered (200 or 404); non-zero on network
 * errors, so a flaky run cannot silently curate an empty set. A course with no
 * working guide is normal (not every guide is published) and stays empty.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { matchDetails, parseCatalogue } from './lib/details.ts'
import { candidateGuideUrls, GUIDE_YEAR } from './lib/guides.ts'
import { CURATION_DIR, INPUT_DIRS, ROOT } from './lib/paths.ts'

const CONCURRENCY = 6
const TIMEOUT_MS = 25000

type BundleCourse = { key: string; name: string }

async function head(url: string): Promise<'found' | 'missing'> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    let res = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: ctrl.signal })
    if (res.status === 405 || res.status === 501) {
      res = await fetch(url, { method: 'GET', redirect: 'follow', signal: ctrl.signal })
      await res.arrayBuffer().catch(() => null)
    }
    if (res.status === 200) return 'found'
    if (res.status === 404) return 'missing'
    throw new Error(`HTTP ${res.status}`)
  } finally {
    clearTimeout(timer)
  }
}

async function main(): Promise<void> {
  const bundle = JSON.parse(
    readFileSync(join(ROOT, 'public', 'bundle.json'), 'utf8'),
  ) as { academicYear: string; courses: BundleCourse[] }
  if (bundle.academicYear !== GUIDE_YEAR) {
    console.error(`bundle is ${bundle.academicYear}, guide lib targets ${GUIDE_YEAR} — update scripts/lib/guides.ts`)
    process.exit(1)
  }

  const csv = INPUT_DIRS.map((dir) => {
    try {
      return readFileSync(
        join(dir, 'Application_ETSIINF_Courses_Incoming_Student_unprotected.csv'),
        'utf8',
      )
    } catch {
      return null
    }
  }).find((s): s is string => s !== null)
  if (!csv) throw new Error('catalogue CSV not found under INPUT_DIRS')

  const catalogue = parseCatalogue(csv)
  const extras = JSON.parse(readFileSync(join(CURATION_DIR, 'details.json'), 'utf8')) as {
    extraMatches?: Record<string, string[]>
  }
  const { byKey } = matchDetails(
    bundle.courses.map((c) => ({ key: c.key, name: c.name })),
    catalogue,
    extras.extraMatches ?? {},
  )

  const urls = new Set<string>()
  for (const rows of byKey.values()) {
    for (const r of rows) {
      for (const u of candidateGuideUrls(r.plans, r.codes)) urls.add(u)
    }
  }
  console.log(`${urls.size} candidate guide URLs from ${byKey.size} matched courses`)

  const verified: string[] = []
  let missing = 0
  let failed = 0
  const queue = [...urls]
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length > 0) {
      const url = queue.pop()!
      try {
        const found = await head(url)
        if (found === 'found') verified.push(url)
        else missing++
      } catch (err) {
        failed++
        console.error(`probe failed: ${url} — ${(err as Error).message}`)
      }
    }
  })
  await Promise.all(workers)

  verified.sort()
  writeFileSync(
    join(CURATION_DIR, 'guides.json'),
    `${JSON.stringify({ year: GUIDE_YEAR, verified }, null, 1)}\n`,
  )
  console.log(`${verified.length} verified · ${missing} missing (404) · ${failed} probe errors`)
  if (failed > 0) process.exit(1)
}

await main()
