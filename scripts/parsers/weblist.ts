/**
 * Parsers for the two web-printed timetables (MUCD 10BA, MUIA).
 *
 * Neither is a positioned grid like T1–T4, so neither needs cell rectangles —
 * both are parsed from text runs alone, which is also why they survive the
 * scaled CTMs of print-to-PDF output:
 *
 *   T5  weekday columns of stacked entries, each entry printing its own time
 *       range (`16:00 – 18:00`) followed by name and `(Classroom NNNN)` lines.
 *       Weekday from the column, times from the printed range.
 *
 *   T6  weekday columns × time-slot rows. The slot label (`10:00 – 12:00`) is
 *       repeated in every column of its row; each cell holds one `A#: name`
 *       block and prints no room. Weekday from the column, times from the row.
 *
 * Web-print runs carry no inter-word spacing, so lines are re-joined from run
 * positions here rather than with the verbatim concatenation the UPM PDFs use.
 */

import {
  assembleName,
  classifyBlock,
  extractRoom,
  groupRunsIntoLines,
  makeBlock,
  stripAnnotations,
  type Line,
  type TextBlock,
} from '../lib/geometry.ts'
import type { Run } from '../lib/types.ts'
import { assertGranularity, parseTimeRange, parseWeekday } from '../lib/time.ts'
import type { SourceSpec } from '../lib/curation.ts'
import type {
  Diagnostic,
  ParsedSession,
  ParsedTimetable,
  PdfExtraction,
  Weekday,
} from '../lib/types.ts'

type Column = { weekday: Weekday; x0: number; x1: number }

/**
 * The table's weekday-header row: the line carrying the most weekday names.
 * Web prints can carry a second, smaller header row (a second-semester table
 * with no entries yet); the fullest row is the table being parsed.
 */
function headerColumns(lines: Line[], path: string): { columns: Column[]; headerY: number } {
  let best: Line | null = null
  let bestN = 0
  for (const line of lines) {
    const n = line.filter((r) => parseWeekday(r.text) !== null).length
    if (n > bestN) {
      bestN = n
      best = line
    }
  }
  if (!best || bestN < 2) throw new Error(`${path}: no weekday header row found`)
  const headerY = best[0]!.y
  const centres = best
    .filter((r) => parseWeekday(r.text) !== null)
    .map((r) => ({ x: r.x + r.w / 2, weekday: parseWeekday(r.text)! }))
    .sort((a, b) => a.x - b.x)
  const edges: number[] = []
  for (let k = 0; k < centres.length; k++) {
    if (k === 0) edges.push(centres[0]!.x - (centres[1]!.x - centres[0]!.x) / 2)
    else edges.push((centres[k - 1]!.x + centres[k]!.x) / 2)
  }
  edges.push(centres.at(-1)!.x + (centres.at(-1)!.x - centres.at(-2)!.x) / 2)
  const columns = centres.map((c, k) => ({ weekday: c.weekday, x0: edges[k]!, x1: edges[k + 1]! }))
  return { columns, headerY }
}

/**
 * Re-join a web-print line's runs with spaces where the positions show a gap.
 * UPM PDFs bake spacing into the run text; these files split `A7:` and its
 * name into adjacent runs that verbatim concatenation would glue. Only a real
 * overlap (a mid-word split) joins directly.
 */
function spacedLineText(line: Line): string {
  let out = line[0]!.text
  for (let k = 1; k < line.length; k++) {
    const prev = line[k - 1]!
    const cur = line[k]!
    const gap = cur.x - (prev.x + prev.w)
    out += /\s$/.test(out) || /^\s/.test(cur.text) || gap < -0.5 ? cur.text : ` ${cur.text}`
  }
  return out
}

/**
 * Collapse each line to one spaced run and merge hyphen-wrapped lines
 * (`intelligence (NEW in 2023-` + `24)`), so downstream assembly sees words.
 */
function normalizeWebLines(lines: Line[]): Line[] {
  const single = lines.map((line) => {
    const first = line[0]!
    const last = line.at(-1)!
    const run: Run = { ...first, text: spacedLineText(line), w: last.x + last.w - first.x }
    return [run] as Line
  })
  const out: Line[] = []
  for (const line of single) {
    const prev = out.at(-1)
    if (prev && /-$/.test(prev[0]!.text.trimEnd())) {
      // Fold the wrap into the previous line's single run (replacing, not
      // appending — the runs' own text would otherwise be counted twice).
      const last = line.at(-1)!
      prev[0] = {
        ...prev[0]!,
        text: `${prev[0]!.text.trimEnd()}${line.map((r) => r.text).join('').trimStart()}`,
        w: last.x + last.w - prev[0]!.x,
      }
    } else {
      out.push(line)
    }
  }
  return out
}

function pushSession(
  sessions: ParsedSession[],
  block: TextBlock,
  weekday: Weekday,
  startMin: number,
  endMin: number,
  spanSource: ParsedSession['spanSource'],
  spec: SourceSpec,
  extraFiller: RegExp[],
  onFiller: () => void,
  roomDefault?: string,
): void {
  const raw = assembleName(block)
  const { name } = stripAnnotations(raw)
  if (name === '' || classifyBlock(name, extraFiller) === 'filler') {
    onFiller()
    return
  }
  assertGranularity(startMin, `${spec.path} ${name} start`)
  assertGranularity(endMin, `${spec.path} ${name} end`)
  sessions.push({
    rawName: name,
    weekday,
    startMin,
    endMin,
    room: extractRoom(block) ?? roomDefault ?? null,
    elective: false,
    validity: null,
    spanSource,
    spanMargin: null,
  })
}

// ── T5 ──────────────────────────────────────────────────────────────────────

/**
 * Entries hang off their time-range line, but website prose and legend lines
 * share the columns below the table. Entry bodies are tight (≤12 pt gaps here)
 * while the drop to the prose is 25 pt+, so a body-gap cutoff keeps the table
 * honest without a hardcoded floor.
 */
const MAX_BODY_GAP_PT = 20

export function parseWebList(
  ex: PdfExtraction,
  spec: SourceSpec,
  opts: { extraFiller?: RegExp[] } = {},
): ParsedTimetable {
  if (!spec.semester) throw new Error(`${spec.path}: timetable source needs a semester`)
  const diagnostics: Diagnostic[] = []
  const lines = groupRunsIntoLines(ex.runs)
  const { columns, headerY } = headerColumns(lines, spec.path)
  const sessions: ParsedSession[] = []
  let fillerCount = 0

  // Content ends at the next weekday-header row below (a second table), if any.
  const floor = lines
    .filter((l) => l[0]!.y < headerY - 3)
    .filter((l) => l.filter((r) => parseWeekday(r.text) !== null).length >= 2)
    .map((l) => l[0]!.y)
    .sort((a, b) => b - a)[0] ?? 0

  for (const col of columns) {
    const colLines = normalizeWebLines(
      lines
        .filter((l) => l[0]!.y < headerY - 1 && l[0]!.y > floor)
        .map((l) => l.filter((r) => r.x + r.w / 2 >= col.x0 && r.x + r.w / 2 < col.x1) as Line)
        .filter((l) => l.length > 0)
        .sort((a, b) => b[0]!.y - a[0]!.y),
    )

    // An entry starts at a time-range line; the lines beneath it, up to the
    // next time-range line, are its name and room.
    let current: Line[] = []
    let ignored = 0
    const flush = (): void => {
      if (current.length === 0) return
      const head = current[0]!.map((r) => r.text).join(' ')
      const range = parseTimeRange(head)
      if (!range) {
        diagnostics.push({
          severity: 'warn',
          code: 'ENTRY_WITHOUT_TIME',
          sourcePath: spec.path,
          detail: `lines under ${col.weekday} do not start with a time range: ${JSON.stringify(head)}`,
        })
        current = []
        return
      }
      const body = current.slice(1)
      if (body.length > 0) {
        pushSession(sessions, makeBlock(body), col.weekday, range.startMin, range.endMin, 'explicit', spec, opts.extraFiller ?? [], () => fillerCount++)
      }
      current = []
    }
    let prevY = Infinity
    let belowTable = false
    for (const line of colLines) {
      if (belowTable) {
        ignored++
        continue
      }
      const gap = prevY - line[0]!.y
      const text = line.map((r) => r.text).join(' ')
      if (parseTimeRange(text)) {
        flush()
        current = [line]
      } else if (current.length > 0 && gap <= MAX_BODY_GAP_PT) {
        current.push(line)
      } else if (current.length > 0) {
        // Below the table: prose sharing the column. The entry is complete;
        // everything after it in this column is prose too.
        flush()
        belowTable = true
        ignored++
      } else {
        diagnostics.push({
          severity: 'warn',
          code: 'ENTRY_WITHOUT_TIME',
          sourcePath: spec.path,
          detail: `stray line under weekday ${col.weekday} with no entry started: ${JSON.stringify(text)}`,
        })
      }
      prevY = line[0]!.y
    }
    flush()
    if (ignored > 0) {
      diagnostics.push({
        severity: 'info',
        code: 'TABLE_JUNK_IGNORED',
        sourcePath: spec.path,
        subject: `weekday ${col.weekday}`,
        detail: `${ignored} non-entry line(s) below the table left out`,
      })
    }
  }

  return {
    kind: 'timetable',
    sourcePath: spec.path,
    layoutFamily: spec.layoutFamily,
    extractionMethod: 'pdfjs',
    programme: spec.programme!,
    semester: spec.semester,
    sessions,
    fillerCount,
    diagnostics,
  }
}

// ── T6 ──────────────────────────────────────────────────────────────────────

const TIME_IN_TEXT = /\d{1,2}:\d{2}/

export function parseDayColumnGrid(
  ex: PdfExtraction,
  spec: SourceSpec,
  opts: { extraFiller?: RegExp[] } = {},
): ParsedTimetable {
  if (!spec.semester) throw new Error(`${spec.path}: timetable source needs a semester`)
  const diagnostics: Diagnostic[] = []
  const lines = groupRunsIntoLines(ex.runs)
  const { columns, headerY } = headerColumns(lines, spec.path)
  const sessions: ParsedSession[] = []
  let fillerCount = 0

  // Slot rows from the printed time labels (one copy per column, same
  // baselines). Rows own the lines beneath their label down to the next
  // label — midpoints would misassign wrapped name lines sitting on the join.
  const labelYs = [...new Set(
    ex.runs
      .filter((r) => r.y < headerY - 1 && TIME_IN_TEXT.test(r.text) && parseTimeRange(r.text.trim()))
      .map((r) => r.y),
  )].sort((a, b) => b - a)
  if (labelYs.length === 0) throw new Error(`${spec.path}: no time-row labels found`)
  const rowLabels = labelYs.map((y) => {
    const run = ex.runs.find((r) => r.y === y && parseTimeRange(r.text.trim()))!
    return { y, ...parseTimeRange(run.text.trim())! }
  })

  // Content ends where the prose notes below the grid begin
  // (`concentrated form` / `concentrated format`).
  const floor = ex.runs.find((r) => /concentrated/i.test(r.text))?.y ?? 0

  for (const col of columns) {
    const colLines = normalizeWebLines(
      lines
        .filter((l) => l[0]!.y < headerY - 1 && l[0]!.y > floor + 2)
        .map((l) => l.filter((r) => r.x + r.w / 2 >= col.x0 && r.x + r.w / 2 < col.x1) as Line)
        .filter((l) => l.length > 0)
        .sort((a, b) => b[0]!.y - a[0]!.y),
    )

    let current: Line[] = []
    let rowIdx = -1
    let prevY = Infinity
    let belowTable = false
    const flush = (): void => {
      if (current.length === 0 || rowIdx < 0) {
        current = []
        return
      }
      // One row-cell holds one course in this layout.
      const row = rowLabels[rowIdx]!
      pushSession(sessions, makeBlock(current), col.weekday, row.startMin, row.endMin, 'inferred', spec, opts.extraFiller ?? [], () => fillerCount++, spec.roomDefault)
      current = []
    }
    for (const line of colLines) {
      if (belowTable) continue
      const gap = prevY - line[0]!.y
      const text = line.map((r) => r.text).join(' ').trim()
      if (parseTimeRange(text)) {
        flush()
        const k = rowLabels.findIndex((r) => Math.abs(r.y - line[0]!.y) < 3)
        if (k < 0) {
          diagnostics.push({
            severity: 'warn',
            code: 'ROW_WITHOUT_LABEL',
            sourcePath: spec.path,
            detail: `time line matches no slot row: ${JSON.stringify(text)}`,
          })
          rowIdx = -1
        } else {
          rowIdx = k
        }
        current = []
      } else if (rowIdx >= 0 && (current.length === 0 || gap <= MAX_BODY_GAP_PT)) {
        current.push(line)
      } else if (rowIdx >= 0) {
        // Below the grid: prose sharing the column (the weeks table, notes).
        flush()
        belowTable = true
      }
      prevY = line[0]!.y
    }
    flush()
  }

  return {
    kind: 'timetable',
    sourcePath: spec.path,
    layoutFamily: spec.layoutFamily,
    extractionMethod: 'pdfjs',
    programme: spec.programme!,
    semester: spec.semester,
    sessions,
    fillerCount,
    diagnostics,
  }
}
