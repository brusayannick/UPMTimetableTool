/**
 * Developer tool: print a committed extraction as a positioned dump.
 *
 *   node scripts/inspect.ts <slug-or-substring> [--rects] [--gaps N]
 *
 * Kept in the repo because the next time UPM publishes a `_v3` PDF, the first
 * thing anyone will need is to see what actually changed geometrically.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { groupRunsIntoLines, splitLineByGaps } from './lib/geometry.ts'
import { EXTRACTED_DIR } from './lib/paths.ts'
import type { PdfExtraction } from './lib/types.ts'

const arg = process.argv[2]
if (!arg) {
  console.error('usage: node scripts/inspect.ts <slug-or-substring> [--rects] [--gaps N]')
  console.error('\navailable:')
  for (const f of readdirSync(EXTRACTED_DIR)) if (f.endsWith('.json') && !f.startsWith('_')) console.error('  ' + f.replace(/\.json$/, ''))
  process.exit(1)
}
const showRects = process.argv.includes('--rects')
const gapIdx = process.argv.indexOf('--gaps')
const gap = gapIdx > 0 ? Number(process.argv[gapIdx + 1]) : 10

const files = readdirSync(EXTRACTED_DIR).filter((f) => f.endsWith('.json') && !f.startsWith('_'))
const hit = files.find((f) => f === `${arg}.json`) ?? files.find((f) => f.includes(arg))
if (!hit) {
  console.error(`no extraction matching ${JSON.stringify(arg)}`)
  process.exit(1)
}

const ex = JSON.parse(readFileSync(join(EXTRACTED_DIR, hit), 'utf8')) as PdfExtraction
console.log(`### ${ex.source.path}`)
console.log(`view ${ex.page.view.join(' ')} · ${ex.runs.length} runs · ${ex.rects.length} rects${ex.imageOnly ? ' · IMAGE-ONLY' : ''}\n`)

for (const line of groupRunsIntoLines(ex.runs)) {
  const cells = splitLineByGaps(line, gap)
    .map((s) => {
      const x0 = Math.min(...s.map((r) => r.x))
      const x1 = Math.max(...s.map((r) => r.x + r.w))
      return `[${x0.toFixed(1)}–${x1.toFixed(1)} ${JSON.stringify(s.map((r) => r.text).join(''))}]`
    })
    .join(' ')
  console.log(`y=${line[0]!.y.toFixed(1).padStart(7)}  ${cells}`)
}

if (showRects) {
  console.log('\n--- rects (x y w h fill op)')
  for (const r of ex.rects) {
    console.log(`  ${r.x.toFixed(2).padStart(8)} ${r.y.toFixed(2).padStart(8)} ${r.w.toFixed(2).padStart(8)} ${r.h.toFixed(2).padStart(7)}  ${r.fill ?? '-'}  ${r.op}`)
  }
}
