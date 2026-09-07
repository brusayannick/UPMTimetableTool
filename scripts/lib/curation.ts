import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CURATION_DIR, EXTRACTED_DIR, VISION_DIR } from './paths.ts'
import type { LayoutFamily, PdfExtraction, Semester, VisionArtefact } from './types.ts'

export type ProgrammeDef = {
  code: string
  short: string
  name: string
  lang: 'es' | 'en'
  colour: string
}

export type SubGridSpec = {
  label: string
  /** Text that announces this sub-grid, for vertically stacked grids (T2). */
  banner?: string
  /** Content x window, for side-by-side grids (T3). */
  xFrom?: number
  xTo?: number
  /** Per-sub-grid weekday label column, for side-by-side grids (T3). */
  labelColumn?: { x0: number; x1: number }
  /** Replacement header labels when the source header is corrupt. */
  headerOverride?: string[]
}

export type SourceSpec = {
  path: string
  kind: 'timetable' | 'exam'
  layoutFamily: LayoutFamily
  programme: string | null
  semester?: Semester
  role: 'primary' | 'crosscheck' | 'out-of-scope'
  labelColumnMaxX?: number
  subGrids?: SubGridSpec[]
  /** Timetable-only: where the weekday row bands come from. Default `labelText`. */
  rowBandsFrom?: 'labelRects' | 'labelText'
  /** Exam-only: where the slot row bands come from. */
  slotBandsFrom?: 'labelRects' | 'labelText' | 'contentRects'
  /** Exam-only: rect fill colour → semester (E-a legend). */
  semesterLegend?: Record<string, Semester>
  /** Filename under data/vision/ for image-only sources. */
  vision?: string
  /**
   * 0-based page indexes to extract. For web-printed PDFs whose timetable lives
   * on one page among website-chrome pages; the excluded pages are junk, and the
   * source entry documents why. Omit for single-page files (which must have
   * exactly one page).
   */
  pages?: number[]
  /**
   * Room printed once for a whole grid (e.g. a `Timetable 2026-27 – Room 6201`
   * title) rather than per cell. Used only when a cell prints no room itself.
   */
  roomDefault?: string
}

export type Fixups = {
  fillerPatterns: string[]
  equivalences: [string, string][]
  roomPrecedence: { programme: string; semester?: Semester; prefer: 'vision' | 'pdfjs'; why: string }[]
  notes: { code: string; text: string }[]
}

export type Aliases = {
  version: number
  canonical: Record<string, { label: string; variants: string[]; note?: string; programmes?: string[] }>
  splits: Record<string, string[]>
  equivalents: [string, string][]
}

export type Declared = { programme: string; name: string; why: string }

export type Expectations = {
  files: Record<string, { courses?: number; filler?: number; exams?: number }>
  orphanExams: Declared[]
  examlessCourses: Declared[]
  sessionlessCourses: Declared[]
  multiExamCourses: Declared[]
}

const readJson = <T>(dir: string, name: string): T =>
  JSON.parse(readFileSync(join(dir, name), 'utf8')) as T

export function loadProgrammes(): {
  programmes: ProgrammeDef[]
  semesters: { code: Semester; labelEs: string; labelEn: string }[]
} {
  return readJson(CURATION_DIR, 'programmes.json')
}

export function loadSources(): SourceSpec[] {
  return readJson<{ sources: SourceSpec[] }>(CURATION_DIR, 'sources.json').sources
}

export const loadFixups = (): Fixups => readJson(CURATION_DIR, 'fixups.json')
export const loadAliases = (): Aliases => readJson(CURATION_DIR, 'aliases.json')
export const loadExpectations = (): Expectations => readJson(CURATION_DIR, 'expectations.json')

export const loadExtraction = (slug: string): PdfExtraction =>
  readJson(EXTRACTED_DIR, `${slug}.json`)

export const loadVision = (name: string): VisionArtefact => readJson(VISION_DIR, name)

/** Compiled filler patterns: the built-in set plus anything declared in fixups. */
export const compileFillerPatterns = (fixups: Fixups): RegExp[] =>
  fixups.fillerPatterns.map((p) => new RegExp(p, 'i'))
