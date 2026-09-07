/**
 * Shared geometry primitives for all six layout parsers.
 *
 * The PDFs have no table structure — only positioned glyphs and filled
 * rectangles. Every parser therefore does the same four things: cluster runs into
 * lines and lines into cell blocks, derive a column grid from the printed header
 * labels, decide which columns a block occupies, and clean the resulting name.
 * Those primitives live here so the parsers stay thin and so the tricky parts are
 * unit-tested once against real fixture numbers.
 */

import { parseTimeRange } from './time.ts'
import type { Rect, Run } from './types.ts'

export type Line = Run[]

/** A horizontal row band, `y0` bottom, `y1` top (PDF space is y-up). */
export type Band = { y0: number; y1: number }

export type Col = { label: string; startMin: number; endMin: number }

export type ColGrid = {
  /** `edges.length === cols.length + 1`; ascending. */
  edges: number[]
  cols: Col[]
  /** Indices `k` where `cols[k].endMin !== cols[k+1].startMin` (e.g. a lunch gap). */
  discontinuities: number[]
}

/** Inclusive column-index range. */
export type Span = { a: number; b: number }

export type TextBlock = {
  lines: Line[]
  nameLines: Line[]
  roomLine: Line | null
  /** Median line centre over *all* lines, room included. */
  centre: number
  /** Median line centre over name lines only. */
  nameCentre: number
  maxLineWidth: number
  xMin: number
  xMax: number
  yTop: number
  yBottom: number
}

export class HeaderGridError extends Error {}
export class MergedLabelError extends Error {}
export class SnapError extends Error {}

const lineText = (line: Line): string => line.map((r) => r.text).join('')
const lineX0 = (line: Line): number => Math.min(...line.map((r) => r.x))
const lineX1 = (line: Line): number => Math.max(...line.map((r) => r.x + r.w))
const lineCentre = (line: Line): number => (lineX0(line) + lineX1(line)) / 2
const lineWidth = (line: Line): number => lineX1(line) - lineX0(line)

function median(xs: number[]): number {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2
}

function percentile(xs: number[], q: number): number {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor(q * s.length))]!
}

// ── clustering ──────────────────────────────────────────────────────────────

/**
 * Cluster runs into lines by baseline y, top to bottom, x-sorted within a line.
 *
 * `yTol` must stay at or above 2.0: the two half-grids of HMDA 3S have header
 * baselines at 479/478 and 467/466, so exact grouping tears the header row in
 * two and the column grid comes out with half the columns.
 */
export function groupRunsIntoLines(runs: Run[], opts: { yTol?: number } = {}): Line[] {
  const yTol = opts.yTol ?? 2.0
  const sorted = [...runs].sort((a, b) => b.y - a.y || a.x - b.x)
  const lines: Line[] = []
  let current: Line = []
  let anchor = Number.NaN
  for (const run of sorted) {
    if (current.length === 0 || Math.abs(run.y - anchor) <= yTol) {
      if (current.length === 0) anchor = run.y
      current.push(run)
    } else {
      lines.push(current.sort((a, b) => a.x - b.x))
      current = [run]
      anchor = run.y
    }
  }
  if (current.length > 0) lines.push(current.sort((a, b) => a.x - b.x))
  return lines
}

/**
 * Split a line where the horizontal gap between consecutive runs exceeds
 * `minGapPt`. Needed because several PDFs put multiple independent cells on one
 * baseline, e.g. `Statistical Data Analysis ‖ Intelligent Systems ‖ (elective)`.
 */
export function splitLineByGaps(line: Line, minGapPt: number): Line[] {
  const sorted = [...line].sort((a, b) => a.x - b.x)
  const out: Line[] = []
  let seg: Line = []
  for (const run of sorted) {
    if (seg.length > 0) {
      const prev = seg[seg.length - 1]!
      if (run.x - (prev.x + prev.w) > minGapPt) {
        out.push(seg)
        seg = []
      }
    }
    seg.push(run)
  }
  if (seg.length > 0) out.push(seg)
  return out
}

// ── row bands ───────────────────────────────────────────────────────────────

/**
 * Distinct y-bands from rectangle extents, merged when they overlap by more than
 * 80 % of the shorter one. Used for the 1645-3S weekday bands, the E-a slot
 * bands and the HCID exam label-column bands.
 */
export function bandsFromRects(rects: Rect[]): Band[] {
  const raw = rects
    .map((r) => ({ y0: r.y, y1: r.y + r.h }))
    .sort((a, b) => b.y1 - a.y1 || b.y0 - a.y0)
  const out: Band[] = []
  for (const band of raw) {
    const last = out[out.length - 1]
    if (last) {
      const overlap = Math.min(last.y1, band.y1) - Math.max(last.y0, band.y0)
      const shorter = Math.min(last.y1 - last.y0, band.y1 - band.y0)
      if (shorter > 0 && overlap / shorter > 0.8) {
        last.y0 = Math.min(last.y0, band.y0)
        last.y1 = Math.max(last.y1, band.y1)
        continue
      }
    }
    out.push({ ...band })
  }
  return out
}

/**
 * Voronoi bands around label baselines, clipped to the grid. The only option for
 * the Fintech exam PDF, which contains no rectangles at all.
 */
export function bandsFromLabelTexts(labelYs: number[], top: number, bottom: number): Band[] {
  const ys = [...labelYs].sort((a, b) => b - a)
  return ys.map((y, k) => ({
    y1: k === 0 ? top : (ys[k - 1]! + y) / 2,
    y0: k === ys.length - 1 ? bottom : (y + ys[k + 1]!) / 2,
  }))
}

/**
 * Map each band to its nearest label by band midpoint.
 *
 * This is the vertically-merged-label primitive: MUII 3S prints 5 weekday names
 * over 9 row bands, so several bands legitimately share a label. Throws
 * `MergedLabelError` if the assignment is not monotonic in label order or if some
 * label claims no band — either means the band or label detection is wrong, and
 * that must fail loudly rather than silently shift every course by a day.
 */
export function assignBandsToLabels<T>(
  bands: Band[],
  labels: { y: number; value: T }[],
  where = 'bands',
): T[] {
  if (labels.length === 0) throw new MergedLabelError(`${where}: no labels`)
  const sortedLabels = [...labels].sort((a, b) => b.y - a.y)
  const idx = bands.map((band) => {
    const mid = (band.y0 + band.y1) / 2
    let best = 0
    let bestD = Infinity
    for (let k = 0; k < sortedLabels.length; k++) {
      const d = Math.abs(sortedLabels[k]!.y - mid)
      if (d < bestD) {
        bestD = d
        best = k
      }
    }
    return best
  })

  for (let i = 1; i < idx.length; i++) {
    if (idx[i]! < idx[i - 1]!) {
      throw new MergedLabelError(
        `${where}: band→label assignment not monotonic at band ${i} (${idx[i - 1]} → ${idx[i]})`,
      )
    }
  }
  const claimed = new Set(idx)
  if (claimed.size !== sortedLabels.length) {
    const missing = sortedLabels.filter((_, k) => !claimed.has(k)).map((l) => String(l.value))
    throw new MergedLabelError(`${where}: labels with no band: ${missing.join(', ')}`)
  }

  return idx.map((k) => sortedLabels[k]!.value)
}

// ── column grid ─────────────────────────────────────────────────────────────

/**
 * Build the column grid from the printed time-range header cells.
 *
 * Header cells may be split across two text lines with an inconsistent split
 * (`18:00 - ` on one baseline, `19:00` on the next, while the neighbouring column
 * prints `15:00 - 16:00` on a single line), so cells are reassembled by x-overlap
 * before parsing.
 *
 * Column boundaries are the midpoints between consecutive label centres, not
 * `gridWidth / n`: several files have column widths that drift by 15 % across the
 * page. Verified against DSC 1S evening, where this reproduces the observed
 * rectangle edges to within 4.5 pt.
 *
 * Throws `HeaderGridError` on a duplicate label or non-monotonic edges — that is
 * what catches the corrupt DSC 1S morning header, which prints `11:00-12:00`
 * twice.
 */
export function colGridFromHeaderLines(
  headerLines: Line[],
  opts: {
    gridLeft: number
    gridRight: number
    minGapPt?: number
    where?: string
    /**
     * Replacement labels for a corrupt header, one per printed cell, left to right.
     * Only the *text* is replaced — the cell positions still come from the PDF, so
     * the derived column edges stay true to the drawing. (Overriding positions too
     * would spread eight columns across the whole banner width, and the DSC 1S
     * morning grid only occupies its left two thirds.)
     */
    overrideLabels?: string[]
  },
): ColGrid {
  const where = opts.where ?? 'header'
  // Header cells almost abut: HMDA prints `15:00 - 16:00` and `16:00 - 17:00`
  // with a 4.4pt gap, while the gap between a *cell* and its neighbour elsewhere
  // is 20pt+. Each printed cell arrives as a single run, so a small threshold is
  // safe here and a large one glues three columns into one unparseable string.
  const minGapPt = opts.minGapPt ?? 3

  // Split every header line into cells, then merge cells across lines by x-overlap.
  type Cell = { x0: number; x1: number; parts: { y: number; text: string }[] }
  const cells: Cell[] = []
  for (const line of headerLines) {
    for (const seg of splitLineByGaps(line, minGapPt)) {
      const x0 = lineX0(seg)
      const x1 = lineX1(seg)
      const text = lineText(seg)
      const y = seg[0]!.y
      const hit = cells.find((c) => Math.min(c.x1, x1) - Math.max(c.x0, x0) > 0.4 * Math.min(c.x1 - c.x0, x1 - x0))
      if (hit) {
        hit.x0 = Math.min(hit.x0, x0)
        hit.x1 = Math.max(hit.x1, x1)
        hit.parts.push({ y, text })
      } else {
        cells.push({ x0, x1, parts: [{ y, text }] })
      }
    }
  }

  const labelled = cells
    .map((c) => ({
      ...c,
      label: c.parts.sort((a, b) => b.y - a.y).map((p) => p.text).join('').replace(/\s+/g, ' ').trim(),
    }))
    .sort((a, b) => (a.x0 + a.x1) / 2 - (b.x0 + b.x1) / 2)

  let parsed: { x0: number; x1: number; label: string; range: { startMin: number; endMin: number } }[]

  if (opts.overrideLabels) {
    if (labelled.length !== opts.overrideLabels.length) {
      throw new HeaderGridError(
        `${where}: headerOverride has ${opts.overrideLabels.length} labels but the PDF prints ` +
        `${labelled.length} header cells (${labelled.map((c) => c.label).join(' | ')})`,
      )
    }
    parsed = labelled.map((c, k) => {
      const label = opts.overrideLabels![k]!
      const range = parseTimeRange(label)
      if (!range) throw new HeaderGridError(`${where}: headerOverride cannot parse ${JSON.stringify(label)}`)
      return { x0: c.x0, x1: c.x1, label, range }
    })
  } else {
    parsed = labelled
      .map((c) => ({ ...c, range: parseTimeRange(c.label) }))
      .filter((c): c is typeof c & { range: { startMin: number; endMin: number } } => c.range !== null)

    if (parsed.length === 0) throw new HeaderGridError(`${where}: no parseable time-range header cells`)

    const seen = new Set<string>()
    for (const c of parsed) {
      if (seen.has(c.label)) {
        throw new HeaderGridError(
          `${where}: duplicate header label ${JSON.stringify(c.label)} — the source header is corrupt; ` +
          `declare a headerOverride for this sub-grid in data/curation/sources.json`,
        )
      }
      seen.add(c.label)
    }
  }

  const centres = parsed.map((c) => (c.x0 + c.x1) / 2)
  const edges = outerEdges(centres, opts.gridLeft, opts.gridRight)

  for (let k = 1; k < edges.length; k++) {
    if (edges[k]! <= edges[k - 1]!) {
      throw new HeaderGridError(`${where}: non-monotonic column edges at ${k}: ${edges.join(', ')}`)
    }
  }

  const cols: Col[] = parsed.map((c) => ({
    label: c.label,
    startMin: c.range.startMin,
    endMin: c.range.endMin,
  }))

  const discontinuities: number[] = []
  for (let k = 0; k + 1 < cols.length; k++) {
    if (cols[k]!.endMin !== cols[k + 1]!.startMin) discontinuities.push(k)
  }

  return { edges, cols, discontinuities }
}

/**
 * Column edges from label centres: midpoints inside, and outside the outermost
 * labels the *mirror* of the neighbouring edge — unless the enclosing band edge is
 * within half a column pitch, in which case the band edge is the real boundary.
 *
 * Both branches are needed. The HCID 3S morning header is left-aligned inside a
 * full-width band, leaving 1.5 columns of unlabelled dead space on the right; using
 * the band edge there would make the last column 225pt wide and every rectangle in
 * it fail to snap. The HCID 3S *evening* header has only two very wide columns, and
 * there the mirror lands 9pt inside the band, so the band edge is correct.
 */
function outerEdges(centres: number[], bandLeft: number, bandRight: number): number[] {
  if (centres.length === 1) return [bandLeft, bandRight]

  const interior: number[] = []
  for (let k = 1; k < centres.length; k++) interior.push((centres[k - 1]! + centres[k]!) / 2)

  const pitch = (centres.at(-1)! - centres[0]!) / (centres.length - 1)
  const pick = (bandEdge: number, mirror: number): number =>
    Math.abs(bandEdge - mirror) < 0.5 * pitch ? bandEdge : mirror

  const left = pick(bandLeft, centres[0]! - (interior[0]! - centres[0]!))
  const right = pick(bandRight, centres.at(-1)! + (centres.at(-1)! - interior.at(-1)!))

  return [left, ...interior, right]
}

/** Split a line into one group per column, by the column containing each run's centre. */
export function splitLineByColumns(line: Line, grid: ColGrid): Map<number, Line> {
  const out = new Map<number, Line>()
  for (const run of line) {
    const col = columnFromTextX(run.x + run.w / 2, grid)
    const existing = out.get(col)
    if (existing) existing.push(run)
    else out.set(col, [run])
  }
  for (const seg of out.values()) seg.sort((a, b) => a.x - b.x)
  return out
}

export const minColWidth = (grid: ColGrid): number =>
  Math.min(...grid.cols.map((_, k) => grid.edges[k + 1]! - grid.edges[k]!))

export const colCentre = (grid: ColGrid, span: Span): number =>
  (grid.edges[span.a]! + grid.edges[span.b + 1]!) / 2

export const spanWidth = (grid: ColGrid, span: Span): number =>
  grid.edges[span.b + 1]! - grid.edges[span.a]!

/** Nearest column edge index. Throws `SnapError` beyond `tolPt`. */
export function snapToEdge(x: number, edges: number[], tolPt: number, where = 'snap'): number {
  let best = 0
  let bestD = Infinity
  for (let k = 0; k < edges.length; k++) {
    const d = Math.abs(edges[k]! - x)
    if (d < bestD) {
      bestD = d
      best = k
    }
  }
  if (bestD > tolPt) {
    throw new SnapError(`${where}: x=${x.toFixed(2)} is ${bestD.toFixed(2)}pt from the nearest edge (tol ${tolPt.toFixed(2)})`)
  }
  return best
}

/** Column span covered by a filled rectangle. Exact where the PDF fills per cell. */
export function spanFromRect(rect: Rect, grid: ColGrid, tolPt?: number, where = 'rect'): Span {
  const tol = tolPt ?? 0.35 * minColWidth(grid)
  const a = snapToEdge(rect.x, grid.edges, tol, `${where} left`)
  const b = snapToEdge(rect.x + rect.w, grid.edges, tol, `${where} right`) - 1
  if (b < a) throw new SnapError(`${where}: degenerate span ${a}..${b}`)
  return { a, b }
}

// ── cell blocks ─────────────────────────────────────────────────────────────

export function makeBlock(lines: Line[]): TextBlock {
  const { room, nameLines, roomLine } = splitRoomLine(lines)
  void room
  return {
    lines,
    nameLines,
    roomLine,
    centre: median(lines.map(lineCentre)),
    nameCentre: median((nameLines.length > 0 ? nameLines : lines).map(lineCentre)),
    maxLineWidth: Math.max(...lines.map(lineWidth)),
    xMin: Math.min(...lines.map(lineX0)),
    xMax: Math.max(...lines.map(lineX1)),
    yTop: Math.max(...lines.map((l) => l[0]!.y)),
    yBottom: Math.min(...lines.map((l) => l[0]!.y)),
  }
}

/**
 * Group the text inside one row band into cell blocks: split each line at
 * horizontal gaps, cluster the segments vertically wherever they overlap in x by
 * more than half the narrower segment, then optionally split a cluster where the
 * vertical spacing jumps.
 *
 * The vertical split is what separates two exams that share one printed cell
 * without a divider. In the MUII exam calendar the line spacing inside a wrapped
 * name is 11–13pt while the gap between two stacked exams is 25–65pt, so a
 * threshold relative to the median spacing separates them reliably. A trailing
 * room line can sit 23pt below its own course, so a fragment that is *only* a room
 * line is folded back into the block above it.
 */
export function blocksInBand(
  lines: Line[],
  band: Band,
  opts: { minGapPt: number; xOverlapFrac?: number; yGapFactor?: number; singleCell?: boolean },
): TextBlock[] {
  const frac = opts.xOverlapFrac ?? 0.5
  const inBand = lines.filter((l) => {
    const y = l[0]!.y
    return y >= band.y0 && y < band.y1
  })

  const segs: Line[] = []
  for (const line of inBand) segs.push(...splitLineByGaps(line, opts.minGapPt))
  segs.sort((a, b) => b[0]!.y - a[0]!.y || lineX0(a) - lineX0(b))

  // When the caller has already carved the text into one cell (exam and calendar
  // grids split by date column first), horizontal clustering would only get in the
  // way: a right-aligned `15:00` does not overlap the centred course name above it.
  if (opts.singleCell) {
    if (segs.length === 0) return []
    const parts = opts.yGapFactor ? splitClusterByYGap(segs, opts.yGapFactor) : [segs]
    return parts.map(makeBlock).sort((a, b) => b.yTop - a.yTop || a.xMin - b.xMin)
  }

  const clusters: Line[][] = []
  for (const seg of segs) {
    const x0 = lineX0(seg)
    const x1 = lineX1(seg)
    let target: Line[] | undefined
    for (const c of clusters) {
      const cx0 = Math.min(...c.map(lineX0))
      const cx1 = Math.max(...c.map(lineX1))
      const overlap = Math.min(cx1, x1) - Math.max(cx0, x0)
      if (overlap > frac * Math.min(cx1 - cx0, x1 - x0)) {
        target = c
        break
      }
    }
    if (target) target.push(seg)
    else clusters.push([seg])
  }

  const split = opts.yGapFactor ? clusters.flatMap((c) => splitClusterByYGap(c, opts.yGapFactor!)) : clusters

  return split
    .map(makeBlock)
    .sort((a, b) => b.yTop - a.yTop || a.xMin - b.xMin)
}

function splitClusterByYGap(cluster: Line[], factor: number): Line[][] {
  if (cluster.length < 3) return [cluster]
  const sorted = [...cluster].sort((a, b) => b[0]!.y - a[0]!.y)
  const gaps: number[] = []
  for (let i = 1; i < sorted.length; i++) gaps.push(sorted[i - 1]![0]!.y - sorted[i]![0]!.y)

  // The baseline is the 25th percentile, not the median: in a column holding two or
  // three stacked exams, half the gaps are *between* cells, which drags the median
  // up above the inter-cell gaps it is supposed to detect. The Monday 12 column of
  // the MUII exam calendar has gaps 12/23/36/12/24 — median 23 finds nothing, p25
  // of 12 separates all three fragments correctly.
  const threshold = percentile(gaps, 0.25) * factor
  if (!(threshold > 0)) return [cluster]

  const parts: Line[][] = [[sorted[0]!]]
  for (let i = 1; i < sorted.length; i++) {
    if (gaps[i - 1]! > threshold) parts.push([sorted[i]!])
    else parts.at(-1)!.push(sorted[i]!)
  }

  // A fragment that is nothing but a room belongs to the block above it.
  const merged: Line[][] = []
  for (const part of parts) {
    const roomOnly = part.length === 1 && isRoomLine(lineText(part[0]!))
    if (roomOnly && merged.length > 0) merged.at(-1)!.push(...part)
    else merged.push(part)
  }
  return merged
}

// ── span inference (the fallback when rectangles are unusable) ───────────────

export type PartitionOptions = {
  /** A span may be up to this fraction narrower than the block's widest line. */
  widthTol?: number
  /** Cost per point of text overflowing the span. */
  overflowPenalty?: number
  /** Report `ambiguous` when the runner-up total is within this many points. */
  ambiguityEps?: number
}

export type PartitionResult = {
  spans: Span[]
  cost: number
  /** Cost gap to the best assignment that differs somewhere; Infinity if unique. */
  margin: number
}

/**
 * Assign each text block in a row band to a column span, when the PDF's
 * rectangles cover a whole row instead of individual cells (HMDA 1S) or are
 * missing entirely (two Fintech blocks).
 *
 * Two rules that a naive implementation gets wrong, both learned from the
 * ground-truth screenshot of HMDA 1S:
 *
 *  - Spans must not be required to tile the extent. HMDA 1S Wednesday's row
 *    rectangle covers 15:00–21:00 but only 15:00–19:00 is occupied; forcing a
 *    tiling ties at the wrong split.
 *  - The room line participates in `centre`. `Room 5001` is the deciding signal
 *    that puts `Big Data / Data Visualization` at 18:00–21:00 rather than
 *    19:00–21:00 — the name alone ties. (For *exam* grids the opposite holds:
 *    room strings there sit under a neighbouring date column, so exam parsers
 *    pass `nameCentre` to `columnFromTextX` instead of using this function.)
 */
export function partitionBandIntoSpans(
  blocks: TextBlock[],
  grid: ColGrid,
  extent: Span,
  opts: PartitionOptions = {},
): PartitionResult {
  const widthTol = opts.widthTol ?? 0.18
  const overflowPenalty = opts.overflowPenalty ?? 1
  const ambiguityEps = opts.ambiguityEps ?? 8

  if (blocks.length === 0) return { spans: [], cost: 0, margin: Infinity }

  const ordered = [...blocks].sort((a, b) => a.centre - b.centre)
  const cut = new Set(grid.discontinuities)

  const candidates = ordered.map((block) => {
    const out: { span: Span; cost: number }[] = []
    for (let a = extent.a; a <= extent.b; a++) {
      for (let b = a; b <= extent.b; b++) {
        let crosses = false
        for (let k = a; k < b; k++) if (cut.has(k)) crosses = true
        if (crosses) continue
        const w = spanWidth(grid, { a, b })
        if (w < block.maxLineWidth * (1 - widthTol)) continue
        const cost =
          Math.abs(block.centre - colCentre(grid, { a, b })) +
          overflowPenalty * Math.max(0, block.maxLineWidth - w)
        out.push({ span: { a, b }, cost })
      }
    }
    // Never return an empty candidate set: a block wider than every legal span
    // still has to land somewhere. Fall back to the whole extent, heavily
    // penalised so it loses to any real fit.
    if (out.length === 0) {
      out.push({
        span: { ...extent },
        cost: 1e4 + Math.abs(block.centre - colCentre(grid, extent)),
      })
    }
    return out.sort((x, y) => x.cost - y.cost)
  })

  // Enumerate every disjoint, ordered (non-tiling) assignment. Bounded: at most
  // 6 columns × 3 blocks in this corpus.
  const solutions: { spans: Span[]; cost: number }[] = []
  const LIMIT = 20000
  let visited = 0
  const walk = (i: number, minCol: number, acc: { span: Span; cost: number }[], cost: number): void => {
    if (visited++ > LIMIT) return
    if (i === candidates.length) {
      solutions.push({ spans: acc.map((c) => c.span), cost })
      return
    }
    for (const c of candidates[i]!) {
      if (c.span.a < minCol) continue
      acc.push(c)
      walk(i + 1, c.span.b + 1, acc, cost + c.cost)
      acc.pop()
    }
  }
  walk(0, extent.a, [], 0)

  if (solutions.length === 0) {
    // No ordered disjoint assignment exists — take each block's own best span and
    // let the caller's overlap checks surface the problem.
    const spans = candidates.map((c) => c[0]!.span)
    const cost = candidates.reduce((s, c) => s + c[0]!.cost, 0)
    return { spans, cost, margin: 0 }
  }

  solutions.sort((a, b) => a.cost - b.cost)
  const best = solutions[0]!
  const key = (s: { spans: Span[] }): string => s.spans.map((p) => `${p.a}-${p.b}`).join(',')
  const bestKey = key(best)
  const runnerUp = solutions.find((s) => key(s) !== bestKey)
  const margin = runnerUp ? runnerUp.cost - best.cost : Infinity

  // Restore the caller's block order (we sorted by centre).
  const byOriginal = new Map<TextBlock, Span>()
  ordered.forEach((block, k) => byOriginal.set(block, best.spans[k]!))

  return {
    spans: blocks.map((b) => byOriginal.get(b)!),
    cost: best.cost,
    margin: margin < ambiguityEps ? margin : margin,
  }
}

/** Column containing a block's name centre. Exam grids only — see the note above. */
export function columnFromTextX(centre: number, grid: ColGrid): number {
  for (let k = 0; k < grid.cols.length; k++) {
    if (centre >= grid.edges[k]! && centre < grid.edges[k + 1]!) return k
  }
  return centre < grid.edges[0]! ? 0 : grid.cols.length - 1
}

// ── text cleanup ────────────────────────────────────────────────────────────

const ROOM_PATTERNS: RegExp[] = [
  /^\s*(?:Aulas?|Rooms?|Classroom)\s+([\dA-Za-z]+(?:\s*-\s*\d+)?)\s*$/i,
  /^\s*\[([^\]]+)\]\s*$/,
  /^\s*\(Classroom\s+([^)]+)\)\s*$/i,
]

const isRoomLine = (text: string): boolean => ROOM_PATTERNS.some((re) => re.test(text))

function splitRoomLine(lines: Line[]): { room: string | null; nameLines: Line[]; roomLine: Line | null } {
  for (let i = lines.length - 1; i >= 0; i--) {
    const text = lineText(lines[i]!)
    for (const re of ROOM_PATTERNS) {
      const m = re.exec(text)
      if (m) {
        return {
          room: m[1]!.replace(/\s+/g, ''),
          nameLines: lines.filter((_, k) => k !== i),
          roomLine: lines[i]!,
        }
      }
    }
  }
  return { room: null, nameLines: lines, roomLine: null }
}

/**
 * Room number from a block, matched on whole lines only — that is what makes both
 * `Aulas 5001-5005` and the double-spaced `Aula  6202` work while never eating a
 * digit out of a course name.
 */
export function extractRoom(block: TextBlock): string | null {
  return splitRoomLine(block.lines).room
}

/** Join a block's name lines in reading order. UPM never hyphenates across lines. */
export function assembleName(block: TextBlock): string {
  const lines = block.nameLines.length > 0 ? block.nameLines : block.lines
  return [...lines]
    .sort((a, b) => b[0]!.y - a[0]!.y || lineX0(a) - lineX0(b))
    .map(lineText)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export type Annotation =
  | { kind: 'explicitRange'; startMin: number; endMin: number; raw: string }
  | { kind: 'startOverride'; startMin: number; raw: string }
  | { kind: 'dateRange'; label: string; raw: string }
  | { kind: 'weekRange'; label: string; raw: string }
  | { kind: 'elective'; raw: string }
  /** A bare trailing `*`. Means "elective" in some files and "shared with other
   *  masters" in others, so the meaning is the parser's call, not ours. */
  | { kind: 'star'; raw: string }
  | { kind: 'placeholder'; raw: string }

/**
 * Strip printed annotations from a course name and return them as structured
 * data — they feed the exam-duration precedence and the session validity rules,
 * so they must survive as values rather than just being deleted.
 */
export function stripAnnotations(input: string): { name: string; annotations: Annotation[] } {
  let s = input
  const annotations: Annotation[] = []

  // `(10:00 to 12:00)`, `(15:00-16:30)`, `(10-12h.)`
  s = s.replace(/\(\s*(\d{1,2}(?::\d{2})?\s*(?:-|–|to)\s*\d{1,2}(?::\d{2})?\s*h?\.?)\s*\)/gi, (raw, body: string) => {
    const r = parseTimeRange(body)
    if (!r) return raw
    annotations.push({ kind: 'explicitRange', startMin: r.startMin, endMin: r.endMin, raw })
    return ' '
  })

  // A bare start-time override, printed as `12:00 h.` beside the course name.
  s = s.replace(/(?:^|\s)(\d{1,2}:\d{2})\s*h\.?(?=\s|$)/g, (raw, t: string) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(t)!
    annotations.push({ kind: 'startOverride', startMin: Number(m[1]) * 60 + Number(m[2]), raw: raw.trim() })
    return ' '
  })

  // `(Weeks 1-7)`
  s = s.replace(/\(\s*(weeks?\s+\d{1,2}\s*-\s*\d{1,2})\s*\)/gi, (raw, label: string) => {
    annotations.push({ kind: 'weekRange', label: label.trim(), raw })
    return ' '
  })

  // `(sep-oct)`, `(nov-ene)`
  s = s.replace(/\(\s*([a-z]{3}\s*-\s*[a-z]{3})\s*\)/gi, (raw, label: string) => {
    annotations.push({ kind: 'dateRange', label: label.replace(/\s+/g, '').toLowerCase(), raw })
    return ' '
  })

  // `(elective)`, `(*)`
  s = s.replace(/\(\s*(?:elective|\*)\s*\)/gi, (raw) => {
    annotations.push({ kind: 'elective', raw })
    return ' '
  })

  // `//////` placeholder cells, inline or standalone
  s = s.replace(/\/{3,}/g, (raw) => {
    annotations.push({ kind: 'placeholder', raw })
    return ' '
  })

  // Trailing `*` — ambiguous, see the `star` doc comment.
  s = s.replace(/\*+\s*$/, (raw) => {
    annotations.push({ kind: 'star', raw: raw.trim() })
    return ' '
  })

  return { name: s.replace(/\s+/g, ' ').trim(), annotations }
}

export const DEFAULT_FILLER_PATTERNS: RegExp[] = [
  /actividades\s+de\s+evaluaci[oó]n/i,
  /uso\s+extraordinario/i,
  /to\s+be\s+used\s+sporadically/i,
  /complementary\s*\/?\s*(?:and\s+)?evaluation\s+activities/i,
  /complementary\s+activities/i,
  /^\s*[/\s]*$/,
]

/**
 * Distinguish real courses from grid filler. `Scientific Research and Advanced
 * Topics` is deliberately *not* filler — it is a real course that happens to
 * have no exam.
 */
export function classifyBlock(name: string, extra: RegExp[] = []): 'course' | 'filler' {
  if (name.trim() === '') return 'filler'
  for (const re of [...DEFAULT_FILLER_PATTERNS, ...extra]) if (re.test(name)) return 'filler'
  return 'course'
}
