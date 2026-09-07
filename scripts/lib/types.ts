/** Shared types for the extraction → parse → db pipeline. */

/** A single positioned text run in PDF user space (y-up, origin bottom-left). */
export type Run = {
  i: number
  /** Baseline origin x. */
  x: number
  /** Baseline origin y. */
  y: number
  /** Advance width of the run. Load-bearing: column inference needs glyph widths. */
  w: number
  /** Nominal glyph height (font size in user space). */
  h: number
  text: string
  font: string
  size: number
}

/** A filled, axis-aligned rectangle in PDF user space. */
export type Rect = {
  i: number
  x: number
  y: number
  w: number
  h: number
  /** Lowercase CSS hex, e.g. `#ffff99`. `null` when no fill colour was set. */
  fill: string | null
  /** `f` = nonzero winding, `f*` = even-odd. */
  op: 'f' | 'f*'
}

export type PdfExtraction = {
  source: { path: string; sha256: string; bytes: number }
  extractor: { name: 'pdfjs'; version: string; scriptHash: string }
  page: { index: number; count: number; view: [number, number, number, number] }
  /** True when the page carries no text layer (scanned/screenshot PDF). */
  imageOnly: boolean
  runs: Run[]
  rects: Rect[]
}

// ── Vision artefacts (data/vision/*.json) ───────────────────────────────────
// Deliberately structurally incompatible with PdfExtraction: no runs/rects, so
// a parser can never mistake one for the other.

export type VisionMeta = {
  extractor: {
    name: 'vision'
    transcribedBy: string
    transcribedAt: string
    /** sha256 of the source PDF at transcription time. `validate` fails if it drifts. */
    sourceSha256: string
    confidence: 'verbatim' | 'best-effort'
  }
  source: { path: string }
}

export type VisionTimetable = VisionMeta & {
  kind: 'timetable'
  programme: string
  semester: Semester
  grids: {
    label: string
    rows: {
      weekday: Weekday
      blocks: {
        name: string
        start: string
        end: string
        room: string | null
        elective?: boolean
        filler?: boolean
      }[]
    }[]
  }[]
}

export type VisionExams = VisionMeta & {
  kind: 'exam'
  programme: string
  /** Row order is the printed order; `end` is omitted when the source prints only a start. */
  entries: { name: string; date: string; start: string; end?: string; room?: string | null }[]
}

export type VisionArtefact = VisionTimetable | VisionExams

// ── Parsed artefacts (data/parsed/*.json) ───────────────────────────────────

export type Semester = '1S' | '3S'
export type Weekday = 1 | 2 | 3 | 4 | 5

export type LayoutFamily =
  | 'T1' | 'T2' | 'T3' | 'T4' | 'T5' | 'T6' | 'IMG-T'
  | 'E-a' | 'E-b' | 'E-c' | 'E-e' | 'IMG-E'

export type SpanSource = 'rect' | 'inferred' | 'explicit' | 'vision'

export type Validity = { label: string; from: string; to: string }

export type ParsedSession = {
  /** Raw course name exactly as printed, before normalisation. */
  rawName: string
  weekday: Weekday
  startMin: number
  endMin: number
  room: string | null
  elective: boolean
  validity: Validity | null
  spanSource: SpanSource
  /** Cost margin to the runner-up span assignment; null when rect/explicit. */
  spanMargin: number | null
}

export type ParsedTimetable = {
  kind: 'timetable'
  sourcePath: string
  layoutFamily: LayoutFamily
  extractionMethod: 'pdfjs' | 'vision'
  programme: string
  semester: Semester
  sessions: ParsedSession[]
  /** Non-course blocks kept for the expected-count assertion. */
  fillerCount: number
  diagnostics: Diagnostic[]
}

export type DurationSource =
  | 'explicit_range'
  | 'start_override_default2h'
  | 'vision_default2h'
  | 'slot_default2h'
  | 'curated'

export type ParsedExam = {
  rawName: string
  /** ISO `YYYY-MM-DD`. */
  date: string
  startMin: number
  endMin: number
  durationSource: DurationSource
  slotLabel: string | null
  room: string | null
  /** Semester as encoded by the source (E-a legend colour), when available. */
  semester: Semester | null
}

export type ParsedExams = {
  kind: 'exam'
  sourcePath: string
  layoutFamily: LayoutFamily
  extractionMethod: 'pdfjs' | 'vision'
  programme: string
  exams: ParsedExam[]
  diagnostics: Diagnostic[]
}

export type ParsedArtefact = ParsedTimetable | ParsedExams

export type Severity = 'error' | 'warn' | 'info'

export type Diagnostic = {
  severity: Severity
  code: string
  sourcePath?: string
  subject?: string
  detail: string
  suggestion?: string
}
