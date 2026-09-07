/**
 * One parser for all four printed timetable layouts.
 *
 * They differ only in how the page is carved into sub-grids — stacked with a
 * `Mornings`/`Evenings` banner (T2), side by side with two weekday-label columns
 * (T3), or a single grid (T1, T4) — and that difference is declared in
 * `data/curation/sources.json`. Everything below the carving is identical, so it
 * lives here once.
 *
 * Span derivation is a single unified rule rather than a per-family special case:
 *
 *   one text block inside a filled cell     → the rectangle *is* the span
 *   several blocks inside one rectangle     → infer spans within that rectangle
 *   a block with no rectangle at all        → infer spans over the free columns
 *
 * That one rule covers T1's exact per-cell fills, HMDA 1S's row-union rectangles,
 * Fintech's two unfilled cells and Fintech's rectangle merged across the lunch
 * gap, without any of them being named in the code.
 */

import {
  assembleName,
  assignBandsToLabels,
  bandsFromLabelTexts,
  bandsFromRects,
  blocksInBand,
  classifyBlock,
  colGridFromHeaderLines,
  extractRoom,
  groupRunsIntoLines,
  minColWidth,
  partitionBandIntoSpans,
  spanFromRect,
  stripAnnotations,
  type Band,
  type ColGrid,
  type Line,
  type Span,
  type TextBlock,
} from '../lib/geometry.ts'
import { assertGranularity, parseWeekday, resolveValidity } from '../lib/time.ts'
import type { SourceSpec, SubGridSpec } from '../lib/curation.ts'
import type {
  Diagnostic,
  ParsedSession,
  ParsedTimetable,
  PdfExtraction,
  Rect,
  Weekday,
} from '../lib/types.ts'

/** Structural lines (borders, separators) rather than cell fills. */
const isStructural = (r: Rect): boolean =>
  r.fill === '#000000' || r.w < 6 || r.h < 6

const isWhite = (r: Rect): boolean => r.fill === null || r.fill === '#ffffff'

type SubGridGeometry = {
  spec: SubGridSpec
  grid: ColGrid
  gridLeft: number
  gridRight: number
  contentTop: number
  contentBottom: number
  labelColumn: { x0: number; x1: number }
}

export function parseTimetable(
  ex: PdfExtraction,
  spec: SourceSpec,
  opts: { extraFiller?: RegExp[] } = {},
): ParsedTimetable {
  if (!spec.semester) throw new Error(`${spec.path}: timetable source needs a semester`)
  const diagnostics: Diagnostic[] = []
  const lines = groupRunsIntoLines(ex.runs)
  const cellRects = ex.rects.filter((r) => !isStructural(r))
  const sessions: ParsedSession[] = []
  let fillerCount = 0

  for (const sub of resolveSubGrids(ex, spec, lines, cellRects, diagnostics)) {
    const inWindow = (x: number): boolean => x >= sub.gridLeft - 2 && x <= sub.gridRight + 2

    // Weekday labels live in the label column, inside this sub-grid's y range.
    const labels = ex.runs
      .filter((r) => r.x >= sub.labelColumn.x0 - 2 && r.x < sub.labelColumn.x1)
      .filter((r) => r.y > sub.contentBottom - 2 && r.y < sub.contentTop)
      .map((r) => ({ y: r.y, value: parseWeekday(r.text) }))
      .filter((l): l is { y: number; value: Weekday } => l.value !== null)

    if (labels.length === 0) {
      diagnostics.push({
        severity: 'warn',
        code: 'NO_WEEKDAY_LABELS',
        sourcePath: spec.path,
        subject: sub.spec.label,
        detail: `no weekday labels found in x∈[${sub.labelColumn.x0}, ${sub.labelColumn.x1}], y∈[${sub.contentBottom.toFixed(1)}, ${sub.contentTop.toFixed(1)}]`,
      })
      continue
    }

    // Row bands come from the weekday-label rectangles where a weekday is drawn
    // across several sub-rows (MUII 3S prints 5 names over 9 bands, and a Voronoi
    // band would merge two courses that share a weekday into one cell). Elsewhere
    // the label baselines are the better signal, because some files leave a whole
    // weekday unfilled and so have fewer rectangles than labels.
    const { bands, weekdays } = spec.rowBandsFrom === 'labelRects'
      ? rowsFromLabelRects(cellRects, sub, labels, spec.path)
      : {
          bands: bandsFromLabelTexts(labels.map((l) => l.y), sub.contentTop, sub.contentBottom),
          weekdays: [...labels].sort((a, b) => b.y - a.y).map((l) => l.value),
        }
    const gapPt = 0.45 * minColWidth(sub.grid)

    for (let bi = 0; bi < bands.length; bi++) {
      const band = bands[bi]!
      const weekday = weekdays[bi]!

      const bandLines = lines
        .map((l) => l.filter((r) => inWindow(r.x)) as Line)
        .filter((l) => l.length > 0)
      const blocks = blocksInBand(bandLines, band, { minGapPt: gapPt })
      if (blocks.length === 0) continue

      const rects = cellRects.filter(
        (r) =>
          !isWhite(r) &&
          r.y + r.h > band.y0 + 1 &&
          r.y < band.y1 - 1 &&
          r.x + r.w > sub.gridLeft - 2 &&
          r.x < sub.gridRight + 2 &&
          r.w > 0.4 * minColWidth(sub.grid),
      )

      for (const { block, span, source, margin } of assignSpans(
        blocks, rects, sub, spec, diagnostics,
      )) {
        const raw = assembleName(block)
        const { name, annotations } = stripAnnotations(raw)
        if (classifyBlock(name, opts.extraFiller ?? []) === 'filler') {
          fillerCount++
          continue
        }

        let startMin = sub.grid.cols[span.a]!.startMin
        let endMin = sub.grid.cols[span.b]!.endMin

        // An inline `(15:00-16:30)` in the label beats both the rectangle and the
        // column grid — it is the only place the source states a half-hour end.
        const explicit = annotations.find((a) => a.kind === 'explicitRange')
        if (explicit?.kind === 'explicitRange') {
          startMin = explicit.startMin
          endMin = explicit.endMin
        }

        assertGranularity(startMin, `${spec.path} ${name} start`)
        assertGranularity(endMin, `${spec.path} ${name} end`)

        const dateRange = annotations.find((a) => a.kind === 'dateRange' || a.kind === 'weekRange')
        let validity: ParsedSession['validity'] = null
        if (dateRange && 'label' in dateRange) {
          const resolved = resolveValidity(dateRange.label)
          if (resolved) validity = { label: dateRange.label, ...resolved }
          else {
            diagnostics.push({
              severity: 'warn',
              code: 'UNRESOLVED_VALIDITY',
              sourcePath: spec.path,
              subject: name,
              detail: `cannot anchor validity label ${JSON.stringify(dateRange.label)}`,
            })
          }
        }

        sessions.push({
          rawName: name,
          weekday,
          startMin,
          endMin,
          room: extractRoom(block),
          elective: annotations.some((a) => a.kind === 'elective' || a.kind === 'star'),
          validity,
          spanSource: explicit ? 'explicit' : source,
          spanMargin: margin,
        })
      }
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

/**
 * Bands from the weekday-label column's filled rectangles, mapped onto the printed
 * weekday names. `assignBandsToLabels` asserts the mapping is monotonic and that
 * every weekday claims at least one band, so a mis-detected band fails the build
 * rather than shifting courses onto the wrong day.
 */
function rowsFromLabelRects(
  cellRects: Rect[],
  sub: SubGridGeometry,
  labels: { y: number; value: Weekday }[],
  path: string,
): { bands: Band[]; weekdays: Weekday[] } {
  const inColumn = cellRects.filter(
    (r) =>
      r.x >= sub.labelColumn.x0 - 2 &&
      r.x + r.w <= sub.labelColumn.x1 + 2 &&
      r.y >= sub.contentBottom - 2 &&
      r.y + r.h <= sub.contentTop + 2,
  )
  const bands = bandsFromRects(inColumn)
  if (bands.length < labels.length) {
    throw new Error(
      `${path} ${sub.spec.label}: rowBandsFrom=labelRects found ${bands.length} bands for ` +
      `${labels.length} weekday labels`,
    )
  }
  return { bands, weekdays: assignBandsToLabels(bands, labels, `${path} ${sub.spec.label} rows`) }
}

// ── span assignment ─────────────────────────────────────────────────────────

type Assignment = {
  block: TextBlock
  span: Span
  source: 'rect' | 'inferred'
  margin: number | null
}

function assignSpans(
  blocks: TextBlock[],
  rects: Rect[],
  sub: SubGridGeometry,
  spec: SourceSpec,
  diagnostics: Diagnostic[],
): Assignment[] {
  const tol = 0.35 * minColWidth(sub.grid)
  const out: Assignment[] = []

  // Which rectangle, if any, contains each block?
  const byRect = new Map<Rect | null, TextBlock[]>()
  for (const block of blocks) {
    const hit =
      rects.find((r) => block.centre >= r.x - 2 && block.centre <= r.x + r.w + 2) ?? null
    const list = byRect.get(hit)
    if (list) list.push(block)
    else byRect.set(hit, [block])
  }

  const occupied: Span[] = []

  for (const [rect, group] of byRect) {
    if (rect === null) continue
    let extent: Span
    try {
      extent = spanFromRect(rect, sub.grid, tol, `${spec.path} rect`)
    } catch (err) {
      diagnostics.push({
        severity: 'warn',
        code: 'RECT_SNAP_FAILED',
        sourcePath: spec.path,
        detail: `${(err as Error).message}; falling back to column inference`,
      })
      byRect.set(null, [...(byRect.get(null) ?? []), ...group])
      continue
    }

    if (group.length === 1) {
      out.push({ block: group[0]!, span: extent, source: 'rect', margin: null })
      occupied.push(extent)
      continue
    }

    // Several blocks share one rectangle: a row-union fill (HMDA 1S) or a fill
    // merged across the lunch gap (Fintech). Split it by text position.
    const res = partitionBandIntoSpans(group, sub.grid, extent)
    group.forEach((block, k) => {
      out.push({ block, span: res.spans[k]!, source: 'inferred', margin: res.margin })
      occupied.push(res.spans[k]!)
    })
    if (res.margin < 8) {
      diagnostics.push({
        severity: 'warn',
        code: 'AMBIGUOUS_SPAN',
        sourcePath: spec.path,
        subject: group.map(assembleName).join(' | '),
        detail: `runner-up span assignment is only ${res.margin.toFixed(1)}pt worse`,
      })
    }
  }

  const orphans = byRect.get(null) ?? []
  if (orphans.length > 0) {
    // Restrict to columns no rectangle already claimed, so an unfilled cell cannot
    // be placed on top of a filled neighbour.
    const free = freeSpan(sub.grid, occupied)
    const res = partitionBandIntoSpans(orphans, sub.grid, free)
    orphans.forEach((block, k) => {
      out.push({ block, span: res.spans[k]!, source: 'inferred', margin: res.margin })
    })
    if (res.margin < 8) {
      diagnostics.push({
        severity: 'warn',
        code: 'AMBIGUOUS_SPAN',
        sourcePath: spec.path,
        subject: orphans.map(assembleName).join(' | '),
        detail: `unfilled cell(s); runner-up span assignment is only ${res.margin.toFixed(1)}pt worse`,
      })
    }
  }

  return out
}

/** The widest contiguous run of columns not covered by `occupied`. */
function freeSpan(grid: ColGrid, occupied: Span[]): Span {
  const taken = new Set<number>()
  for (const s of occupied) for (let k = s.a; k <= s.b; k++) taken.add(k)
  let best: Span = { a: 0, b: grid.cols.length - 1 }
  let bestLen = -1
  let run = -1
  for (let k = 0; k <= grid.cols.length; k++) {
    const free = k < grid.cols.length && !taken.has(k)
    if (free && run < 0) run = k
    if (!free && run >= 0) {
      if (k - run > bestLen) {
        bestLen = k - run
        best = { a: run, b: k - 1 }
      }
      run = -1
    }
  }
  return bestLen < 0 ? { a: 0, b: grid.cols.length - 1 } : best
}

// ── sub-grid carving ────────────────────────────────────────────────────────

function resolveSubGrids(
  ex: PdfExtraction,
  spec: SourceSpec,
  lines: Line[],
  cellRects: Rect[],
  diagnostics: Diagnostic[],
): SubGridGeometry[] {
  const specs = spec.subGrids ?? [{ label: 'Day' }]

  /** Header lines carry at least two parseable time-range cells. */
  const headerLines = lines.filter((l) => countTimeCells(l) >= 2)
  if (headerLines.length === 0) {
    throw new Error(`${spec.path}: no header line with ≥2 time ranges`)
  }

  // Side-by-side layout: one header line spans both halves, split by x window.
  if (specs.some((s) => s.xFrom !== undefined)) {
    return specs.map((s) => {
      const xFrom = s.xFrom!
      const xTo = s.xTo!
      const own = headerLines
        .map((l) => l.filter((r) => r.x >= xFrom - 2 && r.x <= xTo + 2) as Line)
        .filter((l) => l.length > 0)
      const grid = buildGrid(s, own, xFrom, xTo, spec.path)
      const headerBaseline = Math.min(...own.flat().map((r) => r.y))
      const contentTop = headerBaseline - 3
      const contentBottom = Math.min(
        ...cellRects.filter((r) => r.x + r.w > xFrom && r.x < xTo).map((r) => r.y),
      )
      return {
        spec: s,
        grid,
        gridLeft: xFrom,
        gridRight: xTo,
        contentTop,
        contentBottom,
        labelColumn: s.labelColumn ?? { x0: 0, x1: xFrom },
      }
    })
  }

  // Stacked or single grid: each sub-grid owns the highest header line below its
  // banner text, and reaches down to the next banner.
  const bannerYs = specs.map((s) => {
    if (!s.banner) return Infinity
    const run = ex.runs.find((r) => r.text.trim() === s.banner!.trim())
    if (!run) {
      diagnostics.push({
        severity: 'warn',
        code: 'BANNER_NOT_FOUND',
        sourcePath: spec.path,
        subject: s.banner,
        detail: 'sub-grid banner text not found; falling back to header order',
      })
      return Infinity
    }
    return run.y
  })

  const ordered = specs
    .map((s, k) => ({ s, bannerY: bannerYs[k]! }))
    .sort((a, b) => b.bannerY - a.bannerY)

  const out: SubGridGeometry[] = []
  for (let k = 0; k < ordered.length; k++) {
    const { s, bannerY } = ordered[k]!
    const own = Number.isFinite(bannerY)
      ? headerLines.filter((l) => l[0]!.y < bannerY).sort((a, b) => b[0]!.y - a[0]!.y)[0]
      : headerLines.sort((a, b) => b[0]!.y - a[0]!.y)[k]
    if (!own) throw new Error(`${spec.path}: no header line for sub-grid ${s.label}`)

    const headerBaseline = own[0]!.y
    const band = widestRectContaining(cellRects, headerBaseline)
    const gridLeft = band ? band.x : Math.min(...own.map((r) => r.x))
    const gridRight = band ? band.x + band.w : Math.max(...own.map((r) => r.x + r.w))
    const grid = buildGrid(s, [own], gridLeft, gridRight, spec.path)

    const nextBannerY = ordered[k + 1]?.bannerY
    const floor = Number.isFinite(nextBannerY)
      ? nextBannerY! + 2
      : Math.min(...cellRects.filter((r) => r.y < headerBaseline).map((r) => r.y), 0)

    out.push({
      spec: s,
      grid,
      gridLeft,
      gridRight,
      contentTop: band ? band.y : headerBaseline - 3,
      contentBottom: floor,
      labelColumn: { x0: 0, x1: spec.labelColumnMaxX ?? gridLeft },
    })
  }
  return out
}

function buildGrid(s: SubGridSpec, headerLines: Line[], left: number, right: number, path: string): ColGrid {
  return colGridFromHeaderLines(headerLines, {
    gridLeft: left,
    gridRight: right,
    where: `${path} ${s.label}`,
    ...(s.headerOverride ? { overrideLabels: s.headerOverride } : {}),
  })
}

function countTimeCells(line: Line): number {
  let n = 0
  for (const run of line) if (/\d{1,2}:\d{2}\s*(?:-|–|to)?/.test(run.text)) n++
  return n
}

function widestRectContaining(rects: Rect[], y: number): Rect | null {
  let best: Rect | null = null
  for (const r of rects) {
    if (y >= r.y && y <= r.y + r.h && (!best || r.w > best.w)) best = r
  }
  return best
}
