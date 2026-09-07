/**
 * One parser for the three printed exam-grid layouts (E-a, E-b, E-c).
 *
 * All three are date columns × time-slot rows. What differs is only where the row
 * bands come from — filled label-column rectangles (HCID) or the slot-label text
 * baselines (DSC, HMDA, Fintech, which between them have as few as zero
 * rectangles) — and that is declared per file in `sources.json`.
 *
 * Two things this parser must *not* do:
 *
 *  - Use rectangle geometry for the date column. In E-a the fill colour encodes the
 *    semester, not the cell, and rectangles span up to four date columns.
 *  - Include the room line when deciding the date column. Exam PDFs put room
 *    strings under a neighbouring column, so the decision uses `nameCentre`.
 *    (Timetables are the opposite — see `partitionBandIntoSpans`.)
 */

import {
  assembleName,
  assignBandsToLabels,
  bandsFromLabelTexts,
  bandsFromRects,
  blocksInBand,
  classifyBlock,
  splitLineByColumns,
  extractRoom,
  groupRunsIntoLines,
  splitLineByGaps,
  stripAnnotations,
  type Band,
  type Line,
} from '../lib/geometry.ts'
import { deriveExamTime } from '../lib/examtime.ts'
import { assertGranularity, fmtMin, parseExamDate, parseTime } from '../lib/time.ts'
import type { SourceSpec } from '../lib/curation.ts'
import type { Diagnostic, ParsedExam, ParsedExams, PdfExtraction, Rect, Semester } from '../lib/types.ts'

/** Vertical gap that separates two slot labels. Within a label it never exceeds 15pt. */
const SLOT_LABEL_GAP = 30

const isStructural = (r: Rect): boolean => r.fill === '#000000' || r.w < 6 || r.h < 6

export type SlotRow = { band: Band; startMin: number; endMin: number; label: string }

export function parseExams(
  ex: PdfExtraction,
  spec: SourceSpec,
  opts: { extraFiller?: RegExp[] } = {},
): ParsedExams {
  const diagnostics: Diagnostic[] = []
  const lines = groupRunsIntoLines(ex.runs)
  const labelMaxX = spec.labelColumnMaxX ?? 0

  // ── date columns ──────────────────────────────────────────────────────────
  const headerLine = findDateHeader(lines)
  if (!headerLine) throw new Error(`${spec.path}: no date header line found`)

  // Header cells can abut with only a few points between them — HMDA prints
  // `Wednesday 21Thursday 22` as one text run pair.
  const dateCells = splitLineByGaps(headerLine, 3)
    .map((seg) => ({
      text: seg.map((r) => r.text).join('').trim(),
      x0: Math.min(...seg.map((r) => r.x)),
      x1: Math.max(...seg.map((r) => r.x + r.w)),
    }))
    .flatMap(splitGluedDateCell)
    .map((c) => ({ ...c, date: parseExamDate(c.text) }))
    .filter((c) => c.date !== null)
    .sort((a, b) => (a.x0 + a.x1) / 2 - (b.x0 + b.x1) / 2)

  if (dateCells.length < 2) throw new Error(`${spec.path}: parsed only ${dateCells.length} date columns`)

  const headerBand = widestRectContaining(ex.rects.filter((r) => !isStructural(r)), headerLine[0]!.y)
  const gridLeft = Math.max(labelMaxX, dateCells[0]!.x0 - 20)
  const gridRight = headerBand ? headerBand.x + headerBand.w : dateCells.at(-1)!.x1 + 20

  const centres = dateCells.map((c) => (c.x0 + c.x1) / 2)
  const edges = [gridLeft]
  for (let k = 1; k < centres.length; k++) edges.push((centres[k - 1]! + centres[k]!) / 2)
  edges.push(gridRight)
  const dateGrid = {
    edges,
    cols: dateCells.map((c) => ({ label: c.text, startMin: 0, endMin: 0 })),
    discontinuities: [],
  }

  // ── slot rows ─────────────────────────────────────────────────────────────
  const slots =
    spec.slotBandsFrom === 'labelRects' ? slotsFromLabelRects(ex, labelMaxX, headerLine[0]!.y)
    : spec.slotBandsFrom === 'contentRects' ? slotsFromContentRects(ex, labelMaxX, headerLine[0]!.y, spec.path)
    : slotsFromLabelText(ex, labelMaxX, headerLine[0]!.y)

  if (slots.length === 0) throw new Error(`${spec.path}: no slot rows found`)

  // ── cells ─────────────────────────────────────────────────────────────────
  // Cells are carved by *column*, not by horizontal gap. Adjacent date cells can
  // sit only 19pt apart (HCID prints `Introduction and` and `User Interfaces` in
  // neighbouring columns that close), far below any usable gap threshold — but the
  // column boundary between them is unambiguous.
  const exams: ParsedExam[] = []

  for (const slot of slots) {
    const perColumn = new Map<number, Line[]>()
    for (const line of lines) {
      const inBand = line[0]!.y >= slot.band.y0 && line[0]!.y < slot.band.y1
      if (!inBand) continue
      const kept = line.filter((r) => r.x + r.w / 2 >= gridLeft) as Line
      if (kept.length === 0) continue
      for (const [col, seg] of splitLineByColumns(kept, dateGrid)) {
        const list = perColumn.get(col)
        if (list) list.push(seg)
        else perColumn.set(col, [seg])
      }
    }

    for (const [col, colLines] of [...perColumn].sort((a, b) => a[0] - b[0])) {
      // Within a single column every line belongs to that column's cell, so no
      // further horizontal splitting applies.
      for (const block of blocksInBand(colLines, slot.band, { minGapPt: Infinity, singleCell: true, yGapFactor: 1.6 })) {
        const date = dateCells[col]!.date!
        const room = extractRoom(block)
        const semester = spec.semesterLegend
          ? semesterFromFill(ex.rects, block.centre, slot.band, spec.semesterLegend)
          : null

        // A `////` run inside a cell is the printed divider between two stacked
        // courses (verified in the DSC and HCID exam PDFs), so it is a real split
        // signal rather than noise to discard.
        const raw = assembleName(block)
        const parts = raw.split(/\s*\/{3,}\s*/).map((p) => p.trim()).filter((p) => p !== '')
        if (parts.length > 1) {
          diagnostics.push({
            severity: 'info',
            code: 'CELL_SPLIT_ON_PLACEHOLDER',
            sourcePath: spec.path,
            subject: raw,
            detail: `split into ${parts.length} entries on the printed //// divider`,
          })
        }

        for (const part of parts) {
          const { name, annotations } = stripAnnotations(part)
          if (name === '' || classifyBlock(name, opts.extraFiller ?? []) === 'filler') continue

          const timing = deriveExamTime(annotations, slot, 'pdfjs')
          if (timing.outsideSlot) {
            diagnostics.push({
              severity: 'warn',
              code: 'EXPLICIT_OUTSIDE_SLOT',
              sourcePath: spec.path,
              subject: name,
              detail: `printed range ${fmtMin(timing.startMin)}–${fmtMin(timing.endMin)} is not inside slot ${slot.label}`,
            })
          }
          assertGranularity(timing.startMin, `${spec.path} ${name} exam start`)
          assertGranularity(timing.endMin, `${spec.path} ${name} exam end`)

          exams.push({
            rawName: name,
            date,
            startMin: timing.startMin,
            endMin: timing.endMin,
            durationSource: timing.durationSource,
            slotLabel: slot.label,
            room,
            semester,
          })
        }
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

// ── header / slot detection ─────────────────────────────────────────────────

function findDateHeader(lines: Line[]): Line | null {
  let best: Line | null = null
  let bestN = 1
  for (const line of lines) {
    const n = splitLineByGaps(line, 3)
      .flatMap((seg) =>
        splitGluedDateCell({
          text: seg.map((r) => r.text).join('').trim(),
          x0: Math.min(...seg.map((r) => r.x)),
          x1: Math.max(...seg.map((r) => r.x + r.w)),
        }),
      )
      .filter((c) => parseExamDate(c.text) !== null).length
    if (n > bestN) {
      bestN = n
      best = line
    }
  }
  return best
}

/**
 * Two date headers printed with no gap between them, e.g. `Wednesday 21Thursday 22`.
 * Splitting on the boundary between a digit and an uppercase letter recovers both,
 * with widths apportioned by character count.
 */
function splitGluedDateCell(cell: { text: string; x0: number; x1: number }): { text: string; x0: number; x1: number }[] {
  const parts = cell.text.split(/(?<=\d)(?=[A-ZÀ-Þ][a-zà-ÿ])/g)
  if (parts.length < 2) return [cell]
  const total = cell.text.length
  let cursor = cell.x0
  return parts.map((text) => {
    const w = ((cell.x1 - cell.x0) * text.length) / total
    const out = { text, x0: cursor, x1: cursor + w }
    cursor += w
    return out
  })
}

/**
 * Bands from the *content* rectangles, each mapped onto its nearest slot label and
 * then merged per label.
 *
 * The MUII exam calendar needs the rectangles rather than the label baselines for
 * two reasons: its `15:00 - 18:00` row is drawn as two sub-bands with the label
 * centred on the join, and its legend sits below the grid, which a Voronoi band
 * would happily swallow.
 *
 * Sub-bands sharing a label are merged back together, because the split is a
 * layout device, not a time boundary — `Cloud Computing and Big Data Ecosystems
 * Design` wraps straight across it. Separating the two exams that genuinely share
 * such a cell is the job of the vertical-gap rule in `blocksInBand`.
 */
function slotsFromContentRects(ex: PdfExtraction, labelMaxX: number, headerY: number, path: string): SlotRow[] {
  const content = ex.rects.filter(
    (r) => !isStructural(r) && r.h > 20 && r.y + r.h <= headerY + 2 && r.x + r.w > labelMaxX,
  )
  const bands = bandsFromRects(content)
  if (bands.length === 0) return []

  const floor = Math.min(...bands.map((b) => b.y0))
  const labels = slotLabelGroups(ex, labelMaxX, headerY)
    .filter((g) => g.y >= floor - 2)
    .map((g) => ({ y: g.y, value: g }))

  const assigned = assignBandsToLabels(bands, labels, `${path} slot bands`)

  const out: SlotRow[] = []
  bands.forEach((band, k) => {
    const label = assigned[k]!
    const last = out.at(-1)
    if (last && last.label === label.label) {
      last.band = { y0: Math.min(last.band.y0, band.y0), y1: Math.max(last.band.y1, band.y1) }
    } else {
      out.push({ band, startMin: label.startMin, endMin: label.endMin, label: label.label })
    }
  })
  return out
}

function slotsFromLabelRects(ex: PdfExtraction, labelMaxX: number, headerY: number): SlotRow[] {
  const rects = ex.rects.filter(
    (r) => !isStructural(r) && r.x + r.w <= labelMaxX + 2 && r.y + r.h < headerY && r.h > 20,
  )
  return bandsFromRects(rects)
    .map((band) => withSlotLabel(ex, band, labelMaxX))
    .filter((s): s is SlotRow => s !== null)
}

/**
 * Slot labels are printed inconsistently across files: `15:00 - 18:00` as one run
 * (MUII), `10:00 to` + `13:00` as two (DSC), `10:00 -` + `13:00` (HMDA), and
 * `10:00` + `to` + `13:00` as three (HCID, Fintech). Rather than matching each
 * shape, pull every `HH:MM` out of the label column and let the y-grouping decide
 * which belong together.
 */
function slotsFromLabelText(ex: PdfExtraction, labelMaxX: number, headerY: number): SlotRow[] {
  const groups = slotLabelGroups(ex, labelMaxX, headerY)
  const floor = Math.min(...ex.runs.map((r) => r.y), 0)
  const bands = bandsFromLabelTexts(groups.map((g) => g.y), headerY - 5, floor)
  return groups.map((g, k) => ({ band: bands[k]!, startMin: g.startMin, endMin: g.endMin, label: g.label }))
}

/**
 * Slot labels are printed inconsistently across files: `15:00 - 18:00` as one run
 * (MUII), `10:00 to` + `13:00` as two (DSC), `10:00 -` + `13:00` (HMDA), and
 * `10:00` + `to` + `13:00` as three (HCID, Fintech). Rather than matching each
 * shape, pull every `HH:MM` out of the label column and let the vertical grouping
 * decide which belong together.
 */
function slotLabelGroups(
  ex: PdfExtraction,
  labelMaxX: number,
  headerY: number,
): { y: number; startMin: number; endMin: number; label: string }[] {
  const runs = ex.runs
    .filter((r) => r.x < labelMaxX && r.y < headerY)
    .filter((r) => TIME_IN_TEXT.test(r.text) || /^\s*(?:to|-|–)\s*$/i.test(r.text))
    .sort((a, b) => b.y - a.y)

  const groups: typeof runs[] = []
  for (const run of runs) {
    const last = groups.at(-1)
    if (last && Math.abs(last.at(-1)!.y - run.y) <= SLOT_LABEL_GAP) last.push(run)
    else groups.push([run])
  }

  return groups
    .map((g) => ({ g, times: timesIn(g.map((r) => r.text).join(' ')) }))
    .filter((x) => x.times.length >= 2)
    .map(({ g, times }) => ({
      y: (g[0]!.y + g.at(-1)!.y) / 2,
      startMin: times[0]!,
      endMin: times.at(-1)!,
      label: `${fmtMin(times[0]!)}–${fmtMin(times.at(-1)!)}`,
    }))
}

const TIME_IN_TEXT = /\d{1,2}:\d{2}/

function timesIn(text: string): number[] {
  const out: number[] = []
  for (const m of text.matchAll(/(\d{1,2}):(\d{2})/g)) {
    const t = parseTime(`${m[1]}:${m[2]}`)
    if (t !== null) out.push(t)
  }
  return out
}

function withSlotLabel(ex: PdfExtraction, band: Band, labelMaxX: number): SlotRow | null {
  const times = timesIn(
    ex.runs
      .filter((r) => r.x < labelMaxX && r.y >= band.y0 && r.y < band.y1)
      .sort((a, b) => b.y - a.y)
      .map((r) => r.text)
      .join(' '),
  )
  if (times.length < 2) return null
  return {
    band,
    startMin: times[0]!,
    endMin: times.at(-1)!,
    label: `${fmtMin(times[0]!)}–${fmtMin(times.at(-1)!)}`,
  }
}

function semesterFromFill(
  rects: Rect[],
  centre: number,
  band: Band,
  legend: Record<string, Semester>,
): Semester | null {
  for (const r of rects) {
    if (r.fill && legend[r.fill] &&
        centre >= r.x - 2 && centre <= r.x + r.w + 2 &&
        r.y + r.h > band.y0 + 1 && r.y < band.y1 - 1) {
      return legend[r.fill]!
    }
  }
  return null
}

function widestRectContaining(rects: Rect[], y: number): Rect | null {
  let best: Rect | null = null
  for (const r of rects) if (y >= r.y && y <= r.y + r.h && (!best || r.w > best.w)) best = r
  return best
}
