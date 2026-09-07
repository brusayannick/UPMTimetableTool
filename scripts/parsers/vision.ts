/**
 * Parsers for the hand-transcribed image-only PDFs.
 *
 * These take a structurally different input — semantic rows, no glyph coordinates —
 * precisely so that a machine-extracted file can never be fed here by accident and
 * vice versa. Everything they emit is tagged `extractionMethod: 'vision'`, which
 * propagates through the database into the bundle so the UI can badge it.
 */

import { stripAnnotations } from '../lib/geometry.ts'
import { deriveExamTime } from '../lib/examtime.ts'
import { assertGranularity, parseTime, parseWeekday, resolveValidity } from '../lib/time.ts'
import type { SourceSpec } from '../lib/curation.ts'
import type {
  Diagnostic,
  ParsedExam,
  ParsedExams,
  ParsedSession,
  ParsedTimetable,
  VisionExams,
  VisionTimetable,
} from '../lib/types.ts'

export function parseVisionTimetable(art: VisionTimetable, spec: SourceSpec): ParsedTimetable {
  if (!spec.semester) throw new Error(`${spec.path}: vision timetable needs a semester`)
  const diagnostics: Diagnostic[] = []
  const sessions: ParsedSession[] = []
  let fillerCount = 0

  for (const grid of art.grids) {
    for (const row of grid.rows) {
      const weekday = typeof row.weekday === 'number' ? row.weekday : parseWeekday(String(row.weekday))
      if (weekday === null) throw new Error(`${spec.path}: unknown weekday ${JSON.stringify(row.weekday)}`)

      for (const block of row.blocks) {
        if (block.filler) {
          fillerCount++
          continue
        }
        const startMin = parseTime(block.start)
        const endMin = parseTime(block.end)
        if (startMin === null || endMin === null) {
          throw new Error(`${spec.path}: cannot parse ${block.start}–${block.end} for ${block.name}`)
        }
        assertGranularity(startMin, `${spec.path} ${block.name} start`)
        assertGranularity(endMin, `${spec.path} ${block.name} end`)

        const { name, annotations } = stripAnnotations(block.name)
        const range = annotations.find((a) => a.kind === 'dateRange' || a.kind === 'weekRange')
        let validity: ParsedSession['validity'] = null
        if (range && 'label' in range) {
          const resolved = resolveValidity(range.label)
          if (resolved) validity = { label: range.label, ...resolved }
          else {
            diagnostics.push({
              severity: 'warn',
              code: 'UNRESOLVED_VALIDITY',
              sourcePath: spec.path,
              subject: name,
              detail: `cannot anchor validity label ${JSON.stringify(range.label)}`,
            })
          }
        }

        sessions.push({
          rawName: name,
          weekday,
          startMin,
          endMin,
          room: block.room ?? null,
          elective: block.elective === true || annotations.some((a) => a.kind === 'elective' || a.kind === 'star'),
          validity,
          spanSource: 'vision',
          spanMargin: null,
        })
      }
    }
  }

  return {
    kind: 'timetable',
    sourcePath: spec.path,
    layoutFamily: spec.layoutFamily,
    extractionMethod: 'vision',
    programme: spec.programme!,
    semester: spec.semester,
    sessions,
    fillerCount,
    diagnostics,
  }
}

export function parseVisionExams(art: VisionExams, spec: SourceSpec): ParsedExams {
  const exams: ParsedExam[] = []

  for (const entry of art.entries) {
    const startMin = parseTime(entry.start)
    if (startMin === null) throw new Error(`${spec.path}: cannot parse start ${JSON.stringify(entry.start)} for ${entry.name}`)
    const endMin = entry.end ? parseTime(entry.end) : null
    if (entry.end && endMin === null) {
      throw new Error(`${spec.path}: cannot parse end ${JSON.stringify(entry.end)} for ${entry.name}`)
    }

    const { name, annotations } = stripAnnotations(entry.name)
    const timing = deriveExamTime(
      annotations,
      { startMin, endMin: endMin ?? startMin + 180 },
      'vision',
      endMin === null ? { startMin } : { startMin, endMin },
    )
    assertGranularity(timing.startMin, `${spec.path} ${name} exam start`)
    assertGranularity(timing.endMin, `${spec.path} ${name} exam end`)

    exams.push({
      rawName: name,
      date: entry.date,
      startMin: timing.startMin,
      endMin: timing.endMin,
      durationSource: timing.durationSource,
      slotLabel: null,
      room: entry.room ?? null,
      semester: null,
    })
  }

  return {
    kind: 'exam',
    sourcePath: spec.path,
    layoutFamily: spec.layoutFamily,
    extractionMethod: 'vision',
    programme: spec.programme!,
    exams,
    diagnostics: [],
  }
}
