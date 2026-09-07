/**
 * The E-e layout: a month calendar rather than a date-columns × time-rows grid.
 *
 * `exams/January_26.pdf` is a second, redundant view of the DSC exams. It is not a
 * primary source — its value is as a cross-check, because it is the only file in the
 * corpus whose fonts need per-font `ToUnicode` CMaps. Without CMap resolution its
 * glyphs come out as `!"#$"%&'()`, so if the pdfjs text path ever regresses, this
 * parser is where it shows up instead of failing silently.
 *
 * Structure: a weekday header row (`MONDAY`…`SUNDAY`) defining seven columns, then
 * alternating rows of day numbers and cell content. Each day cell holds exactly one
 * course name and one start time, so unlike the exam grids there is no vertical-gap
 * cell splitting here — applying it would cut wrapped names apart.
 *
 * The calendar covers fewer exams than the DSC grid does (8 of 13), which is why the
 * cross-check asserts a subset rather than equality.
 */

import {
  assembleName,
  blocksInBand,
  classifyBlock,
  columnFromTextX,
  groupRunsIntoLines,
  splitLineByColumns,
  stripAnnotations,
  type ColGrid,
  type Line,
} from '../lib/geometry.ts'
import { DEFAULT_EXAM_MINUTES } from '../lib/examtime.ts'
import { assertGranularity, EXAM_MONTH, EXAM_YEAR, isoDate, parseTime, parseWeekday } from '../lib/time.ts'
import type { SourceSpec } from '../lib/curation.ts'
import type { Diagnostic, ParsedExam, ParsedExams, PdfExtraction } from '../lib/types.ts'

export function parseCalendar(
  ex: PdfExtraction,
  spec: SourceSpec,
  opts: { extraFiller?: RegExp[] } = {},
): ParsedExams {
  const diagnostics: Diagnostic[] = []
  const lines = groupRunsIntoLines(ex.runs)

  // ── weekday columns ───────────────────────────────────────────────────────
  const headerLine = lines.find((l) => l.filter((r) => parseWeekday(r.text) !== null).length >= 5)
  if (!headerLine) throw new Error(`${spec.path}: no weekday header row`)

  const headerCells = headerLine
    .filter((r) => parseWeekday(r.text) !== null || /^(SATURDAY|SUNDAY)$/i.test(r.text.trim()))
    .map((r) => ({ text: r.text.trim(), centre: r.x + r.w / 2 }))
    .sort((a, b) => a.centre - b.centre)

  const pageLeft = Math.min(...ex.runs.map((r) => r.x))
  const pageRight = Math.max(...ex.runs.map((r) => r.x + r.w))
  const edges = [pageLeft]
  for (let k = 1; k < headerCells.length; k++) {
    edges.push((headerCells[k - 1]!.centre + headerCells[k]!.centre) / 2)
  }
  edges.push(pageRight)
  const grid: ColGrid = {
    edges,
    cols: headerCells.map((c) => ({ label: c.text, startMin: 0, endMin: 0 })),
    discontinuities: [],
  }

  // ── week rows: each starts at a line of bare day numbers ──────────────────
  const dayRows = lines
    .filter((l) => l[0]!.y < headerLine[0]!.y)
    .map((l) => ({
      y: l[0]!.y,
      days: l
        .filter((r) => /^\d{1,2}$/.test(r.text.trim()))
        .map((r) => ({ day: Number(r.text.trim()), col: columnFromTextX(r.x + r.w / 2, grid) })),
    }))
    .filter((r) => r.days.length >= 5)
    .sort((a, b) => b.y - a.y)

  if (dayRows.length === 0) throw new Error(`${spec.path}: no day-number rows`)

  const floor = Math.min(...ex.runs.map((r) => r.y))
  const exams: ParsedExam[] = []

  for (let wi = 0; wi < dayRows.length; wi++) {
    const row = dayRows[wi]!
    const band = { y0: wi + 1 < dayRows.length ? dayRows[wi + 1]!.y + 1 : floor - 1, y1: row.y - 1 }
    const dayByCol = new Map(row.days.map((d) => [d.col, d.day]))

    const perColumn = new Map<number, Line[]>()
    for (const line of lines) {
      const y = line[0]!.y
      if (y < band.y0 || y >= band.y1) continue
      for (const [col, seg] of splitLineByColumns(line, grid)) {
        const list = perColumn.get(col)
        if (list) list.push(seg)
        else perColumn.set(col, [seg])
      }
    }

    for (const [col, colLines] of perColumn) {
      const day = dayByCol.get(col)
      if (day === undefined) continue

      for (const block of blocksInBand(colLines, band, { minGapPt: Infinity, singleCell: true })) {
        // The start time is a run of its own, but the calendar's leading is tight
        // enough that it shares a baseline cluster with a name fragment (`15:00`
        // at y=443 next to `Knowledge` at y=444). So the split has to happen at
        // run level, not line level.
        let startMin: number | null = null
        const nameLines: Line[] = []
        for (const line of block.lines) {
          const kept: Line = []
          for (const run of line) {
            const t = parseTime(run.text.trim())
            if (t !== null && startMin === null) startMin = t
            else if (t === null) kept.push(run)
          }
          if (kept.length > 0) nameLines.push(kept)
        }

        const raw = assembleName({ ...block, nameLines, lines: nameLines })
        const { name } = stripAnnotations(raw)
        if (name === '' || classifyBlock(name, opts.extraFiller ?? []) === 'filler') continue

        if (startMin === null) {
          diagnostics.push({
            severity: 'warn',
            code: 'CALENDAR_NO_TIME',
            sourcePath: spec.path,
            subject: name,
            detail: `no start time printed in the ${isoDate(EXAM_YEAR, EXAM_MONTH, day)} cell`,
          })
          continue
        }

        assertGranularity(startMin, `${spec.path} ${name} exam start`)
        exams.push({
          rawName: name,
          date: isoDate(EXAM_YEAR, EXAM_MONTH, day),
          startMin,
          endMin: startMin + DEFAULT_EXAM_MINUTES,
          durationSource: 'slot_default2h',
          slotLabel: null,
          room: null,
          semester: null,
        })
      }
    }
  }

  return {
    kind: 'exam',
    sourcePath: spec.path,
    layoutFamily: spec.layoutFamily,
    extractionMethod: 'pdfjs',
    programme: spec.programme!,
    exams,
    diagnostics,
  }
}
