/**
 * Stage 2: `data/extracted/*.json` + `data/vision/*.json` → `data/parsed/*.json`.
 *
 * Committed, so that a parser change shows up as a reviewable data diff.
 *
 *   node scripts/parse.ts                 all in-scope sources
 *   node scripts/parse.ts --only 2235     one programme, for phased bring-up
 *   node scripts/parse.ts --show          also print a human-readable summary
 */

import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  compileFillerPatterns,
  loadExtraction,
  loadFixups,
  loadSources,
  loadVision,
} from './lib/curation.ts'
import { PARSED_DIR, slugFor } from './lib/paths.ts'
import { fmtMin, WEEKDAY_LABELS } from './lib/time.ts'
import { parseCalendar } from './parsers/calendar.ts'
import { parseExams } from './parsers/exams.ts'
import { parseTimetable } from './parsers/timetable.ts'
import { parseDayColumnGrid, parseWebList } from './parsers/weblist.ts'
import { parseVisionExams, parseVisionTimetable } from './parsers/vision.ts'
import type { ParsedArtefact } from './lib/types.ts'

const onlyIdx = process.argv.indexOf('--only')
const only = onlyIdx > 0 ? process.argv[onlyIdx + 1] : null
const show = process.argv.includes('--show')

const fixups = loadFixups()
const extraFiller = compileFillerPatterns(fixups)

let failures = 0
const written: string[] = []

for (const spec of loadSources()) {
  if (spec.role === 'out-of-scope') continue
  if (only && spec.programme !== only) continue

  const slug = slugFor(spec.path)
  let parsed: ParsedArtefact
  try {
    if (spec.vision) {
      const art = loadVision(spec.vision)
      parsed = art.kind === 'timetable'
        ? parseVisionTimetable(art, spec)
        : parseVisionExams(art, spec)
    } else if (spec.layoutFamily === 'T5') {
      parsed = parseWebList(loadExtraction(slug), spec, { extraFiller })
    } else if (spec.layoutFamily === 'T6') {
      parsed = parseDayColumnGrid(loadExtraction(slug), spec, { extraFiller })
    } else if (spec.kind === 'timetable') {
      parsed = parseTimetable(loadExtraction(slug), spec, { extraFiller })
    } else if (spec.layoutFamily === 'E-e') {
      parsed = parseCalendar(loadExtraction(slug), spec, { extraFiller })
    } else {
      parsed = parseExams(loadExtraction(slug), spec, { extraFiller })
    }
  } catch (err) {
    failures++
    console.error(`✗ ${spec.path}\n  ${(err as Error).message}`)
    continue
  }

  await writeFile(join(PARSED_DIR, `${slug}.json`), `${JSON.stringify(parsed, null, 1)}\n`)
  written.push(slug)

  const n = parsed.kind === 'timetable' ? parsed.sessions.length : parsed.exams.length
  const unit = parsed.kind === 'timetable' ? 'sessions' : 'exams'
  const warns = parsed.diagnostics.filter((d) => d.severity !== 'info').length
  console.log(
    `${String(n).padStart(3)} ${unit.padEnd(8)} ${parsed.layoutFamily.padEnd(5)} ` +
    `${parsed.programme}${'semester' in parsed ? '/' + parsed.semester : '   '}  ${spec.path}` +
    (warns ? `  (${warns} warn)` : ''),
  )
  for (const d of parsed.diagnostics) {
    if (d.severity === 'info' && !show) continue
    console.log(`      ${d.severity === 'error' ? '✗' : d.severity === 'warn' ? '!' : 'i'} ${d.code}: ${d.detail}${d.subject ? ` — ${d.subject}` : ''}`)
  }

  if (show) {
    if (parsed.kind === 'timetable') {
      for (const s of [...parsed.sessions].sort((a, b) => a.weekday - b.weekday || a.startMin - b.startMin)) {
        console.log(
          `        ${WEEKDAY_LABELS[s.weekday].padEnd(9)} ${fmtMin(s.startMin)}–${fmtMin(s.endMin)} ` +
          `${(s.room ?? '—').padEnd(10)} ${s.spanSource.padEnd(8)} ${s.rawName}` +
          (s.validity ? `  [${s.validity.label}]` : '') + (s.elective ? '  (elective)' : ''),
        )
      }
    } else {
      for (const e of [...parsed.exams].sort((a, b) => a.date.localeCompare(b.date) || a.startMin - b.startMin)) {
        console.log(
          `        ${e.date} ${fmtMin(e.startMin)}–${fmtMin(e.endMin)} ` +
          `${e.durationSource.padEnd(26)} ${(e.room ?? '—').padEnd(12)} ${e.rawName}`,
        )
      }
    }
  }
}

console.log(`\n${written.length} parsed · ${failures} failed`)
if (failures > 0) process.exit(1)
