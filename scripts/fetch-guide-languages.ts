/**
 * Read the teaching language out of every verified learning guide.
 *
 * Downloads each PDF in `data/curation/guides.json`, parses its first pages,
 * and records the `LANGUAGE … ENGLISH` / `IDIOMA … ESPAÑOL` header statement
 * per plan/code pair. Writes the result back into `guides.json` alongside the
 * verified URL list (which is preserved untouched).
 *
 *   npm run guides:lang
 *
 * Exit status: non-zero on download/parse errors. A guide with no readable
 * language statement is reported but keeps no entry — unknown stays unknown.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { groupRunsIntoLines } from './lib/geometry.ts'
import { extractGuideLanguage, GUIDE_YEAR, guidePair } from './lib/guides.ts'
import { CURATION_DIR } from './lib/paths.ts'
import type { Run } from './lib/types.ts'

const CONCURRENCY = 4
const TIMEOUT_MS = 60000

async function guideLines(url: string): Promise<string[]> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, { redirect: 'follow', signal: ctrl.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const doc = await getDocument({
      data: new Uint8Array(await res.arrayBuffer()),
      isEvalSupported: false,
      verbosity: 0,
    } as Parameters<typeof getDocument>[0]).promise
    // Grouped per page: every page lives in its own 0–842 coordinate space,
    // so joint grouping would interleave the two pages into garbage lines.
    const lines: string[] = []
    for (let p = 1; p <= Math.min(2, doc.numPages); p++) {
      const tc = await (await doc.getPage(p)).getTextContent({ disableNormalization: true })
      const runs: Run[] = []
      for (const item of tc.items) {
        if (!('str' in item)) continue
        if (item.str === '' || item.str.trim() === '') continue
        const tr = item.transform as number[]
        runs.push({
          i: runs.length,
          x: tr[4]!,
          y: tr[5]!,
          w: item.width,
          h: item.height,
          text: item.str,
          font: item.fontName,
          size: Math.abs(tr[3]!) || Math.abs(tr[0]!),
        })
      }
      lines.push(...groupRunsIntoLines(runs).map((l) => l.map((r) => r.text).join(' ')))
    }
    return lines
  } finally {
    clearTimeout(timer)
  }
}

async function main(): Promise<void> {
  const path = join(CURATION_DIR, 'guides.json')
  const data = JSON.parse(readFileSync(path, 'utf8')) as {
    year?: string
    verified?: string[]
    languages?: Record<string, string[]>
  }
  if (data.year !== GUIDE_YEAR) {
    console.error(`guides.json is ${data.year}, guide lib targets ${GUIDE_YEAR}`)
    process.exit(1)
  }
  const urls = data.verified ?? []

  const languages: Record<string, string[]> = {}
  const unknown: string[] = []
  const failed: string[] = []
  const queue = [...urls]
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length > 0) {
      const url = queue.pop()!
      const pair = guidePair(url)
      if (!pair) {
        failed.push(`${url} — not a GA_ URL`)
        continue
      }
      try {
        const lines = await guideLines(url)
        if (lines.length < 10) {
          throw new Error('empty text layer — possible throttled response, re-run later')
        }
        const lang = extractGuideLanguage(lines)
        const key = `${pair.plan}|${pair.code}`
        if (lang) {
          const set = new Set(languages[key] ?? [])
          set.add(lang)
          languages[key] = [...set].sort()
        } else {
          unknown.push(url)
        }
      } catch (err) {
        failed.push(`${url} — ${(err as Error).message}`)
      }
    }
  })
  await Promise.all(workers)

  writeFileSync(path, `${JSON.stringify({ year: data.year, verified: urls, languages }, null, 1)}\n`)
  console.log(
    `${Object.keys(languages).length} plan/code pairs with a language · ` +
      `${unknown.length} unreadable · ${failed.length} failed`,
  )
  for (const u of unknown) console.log(`  no statement: ${u}`)
  for (const f of failed) console.log(`  failed: ${f}`)
  if (failed.length > 0) process.exit(1)
}

await main()
