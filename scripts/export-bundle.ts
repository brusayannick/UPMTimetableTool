/**
 * Stage 4: `data/upm.sqlite` → `public/bundle.json`.
 *
 * The bundle is course-centric because the drag unit in the UI is a course and every
 * read is "given these course keys, show me their sessions and exams". Sessions carry
 * their programme, since rooms and times can differ between programmes offering the
 * same course.
 *
 * Fields the UI needs in order to be honest about the data are carried through:
 * `assumed` marks an exam end derived from the 2-hour default, `inferred` marks a
 * session span read off text position rather than a printed cell, and `vision` marks
 * anything transcribed from an image-only PDF.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { loadProgrammes } from './lib/curation.ts'
import { openDb, rows } from './lib/db.ts'
import { loadCatalogue, loadDetailExtras, matchDetails, type CatalogueRow } from './lib/details.ts'
import { candidateGuideUrls, planCodePairs } from './lib/guides.ts'
import { DEFAULT_EXAM_MINUTES } from './lib/examtime.ts'
import { BUNDLE_PATH, DB_PATH, ROOT } from './lib/paths.ts'
import { EXAM_WINDOW } from './lib/time.ts'
import type { Semester, Weekday } from './lib/types.ts'

const db = openDb(DB_PATH)

type SessionOut = {
  prog: string
  sem: Semester
  d: Weekday
  s: number
  e: number
  room: string | null
  v?: { label: string; from: string; to: string }
  inferred?: true
  vision?: true
}

type ExamOut = {
  date: string
  s: number
  e: number
  room: string | null
  slot: string | null
  assumed?: true
  vision?: true
  witnesses: number
  progs: string[]
}

type CourseOut = {
  key: string
  name: string
  progs: string[]
  elective: boolean
  sessions: SessionOut[]
  exams: ExamOut[]
  details?: CatalogueRow[]
}

const courseRows = rows<{
  id: number
  key: string
  name: string
  prog: string
  elective: number
}>(db, `
  SELECT c.id, c.canonical_key AS key, c.display_name AS name, p.code AS prog, c.is_elective AS elective
  FROM course c JOIN programme p ON p.id = c.programme_id
  ORDER BY c.display_name COLLATE NOCASE
`)

const sessionRows = rows<{
  course_id: number
  prog: string
  sem: Semester
  d: number
  s: number
  e: number
  room: string | null
  label: string | null
  vfrom: string | null
  vto: string | null
  span_source: string
  method: string
}>(db, `
  SELECT s.course_id, p.code AS prog, sem.code AS sem, s.weekday AS d,
         s.start_min AS s, s.end_min AS e, s.room,
         s.validity_label AS label, s.valid_from AS vfrom, s.valid_to AS vto,
         s.span_source, sf.extraction_method AS method
  FROM session s
  JOIN course c ON c.id = s.course_id
  JOIN programme p ON p.id = c.programme_id
  JOIN semester sem ON sem.id = s.semester_id
  JOIN source_file sf ON sf.id = s.source_file_id
  ORDER BY s.weekday, s.start_min
`)

const examRows = rows<{
  course_id: number
  key: string
  prog: string
  date: string
  s: number
  e: number
  room: string | null
  slot: string | null
  duration_source: string
  method: string
  witnesses: number
}>(db, `
  SELECT e.course_id, c.canonical_key AS key, p.code AS prog, e.date,
         e.start_min AS s, e.end_min AS e, e.room, e.slot_label AS slot,
         e.duration_source, sf.extraction_method AS method,
         (SELECT COUNT(*) FROM exam_witness w WHERE w.exam_id = e.id) AS witnesses
  FROM exam e
  JOIN course c ON c.id = e.course_id
  JOIN programme p ON p.id = c.programme_id
  JOIN source_file sf ON sf.id = e.source_file_id
  ORDER BY e.date, e.start_min
`)

// Group by canonical key so a course offered by several programmes is one card in the
// sidebar, with its programme tags listed. Sessions and exams keep their programme.
const byKey = new Map<string, CourseOut>()
const idToKey = new Map<number, string>()

for (const c of courseRows) {
  idToKey.set(c.id, c.key)
  const existing = byKey.get(c.key)
  if (existing) {
    if (!existing.progs.includes(c.prog)) existing.progs.push(c.prog)
    if (c.elective) existing.elective = true
    continue
  }
  byKey.set(c.key, {
    key: c.key,
    name: c.name,
    progs: [c.prog],
    elective: c.elective === 1,
    sessions: [],
    exams: [],
  })
}

// Incoming-student catalogue details, joined by normalised name. Both CSV
// editions are matched at once: the English file carries the 10AN/10AM/10AZ/
// 10AK/10BA rows, the Spanish one the 10AJ (MUIA) rows. A course neither file
// knows simply gets no `details` — the popup then shows the timetable/exam
// data only. A stale curated mapping, however, fails the build: it means a
// display name drifted and nobody noticed.
const CATALOGUE_FILES = [
  'Application_ETSIINF_Courses_Incoming_Student_unprotected.csv',
  'Application_ETSIINF_Courses_Incoming_Student_unprotected spanish.csv',
]
const catalogue = CATALOGUE_FILES.flatMap((file) => {
  try {
    return loadCatalogue(join(ROOT, 'timetables', file))
  } catch {
    console.error(`catalogue file missing: timetables/${file}`)
    process.exit(1)
  }
})
const { byKey: detailsByKey, report: detailsReport } = matchDetails(
  [...byKey.values()].map((c) => ({ key: c.key, name: c.name })),
  catalogue,
  loadDetailExtras(),
)
for (const [key, rows] of detailsByKey) {
  byKey.get(key)!.details = rows
}

// Learning guides: each row's verified subset of its candidate URLs, one per
// line. Rows with nothing verified keep an empty cell, as before.
let guideFile: { verified?: string[]; languages?: Record<string, string[]> }
try {
  guideFile = JSON.parse(readFileSync(join(ROOT, 'data', 'curation', 'guides.json'), 'utf8'))
} catch {
  guideFile = {}
}
const guideVerified = new Set(guideFile.verified ?? [])
const guideLanguages = guideFile.languages ?? {}
let guidesFilled = 0
for (const rows of detailsByKey.values()) {
  for (const r of rows) {
    const urls = candidateGuideUrls(r.plans, r.codes).filter((u) => guideVerified.has(u))
    if (urls.length > 0) {
      r.learningGuide = urls.join('\n')
      guidesFilled++
    }
    const langs = new Set<string>()
    for (const { plan, code } of planCodePairs(r.plans, r.codes)) {
      for (const lang of guideLanguages[`${plan}|${code}`] ?? []) langs.add(lang)
    }
    if (langs.size > 0) r.taughtIn = [...langs].sort().join(' + ')
  }
}
console.log(`${guidesFilled} catalogue rows with a verified learning guide`)
console.log(
  `${detailsByKey.size}/${byKey.size} courses with catalogue details` +
    (detailsReport.unmatchedCourses.length > 0
      ? ` (${detailsReport.unmatchedCourses.length} without: ${detailsReport.unmatchedCourses.join('; ')})`
      : ''),
)
if (detailsReport.unusedExtras.length > 0) {
  console.error(`stale details.json mappings:\n  ${detailsReport.unusedExtras.join('\n  ')}`)
  process.exit(1)
}

const seenSession = new Set<string>()
for (const s of sessionRows) {
  const course = byKey.get(idToKey.get(s.course_id)!)
  if (!course) continue
  const dedupe = `${course.key}|${s.prog}|${s.sem}|${s.d}|${s.s}|${s.e}|${s.label ?? ''}`
  if (seenSession.has(dedupe)) continue
  seenSession.add(dedupe)

  const out: SessionOut = {
    prog: s.prog,
    sem: s.sem,
    d: s.d as Weekday,
    s: s.s,
    e: s.e,
    room: s.room,
  }
  if (s.label && s.vfrom && s.vto) out.v = { label: s.label, from: s.vfrom, to: s.vto }
  if (s.span_source === 'inferred') out.inferred = true
  if (s.method === 'vision') out.vision = true
  course.sessions.push(out)
}

// One exam per (course key, date, start): the same exam printed in several
// programmes' calendars is one event the student sits once.
const examIndex = new Map<string, ExamOut>()
for (const e of examRows) {
  const course = byKey.get(e.key)
  if (!course) continue
  const id = `${e.key}|${e.date}|${e.s}`
  const existing = examIndex.get(id)
  if (existing) {
    if (!existing.progs.includes(e.prog)) existing.progs.push(e.prog)
    existing.witnesses += e.witnesses
    continue
  }
  const out: ExamOut = {
    date: e.date,
    s: e.s,
    e: e.e,
    room: e.room,
    slot: e.slot,
    witnesses: e.witnesses,
    progs: [e.prog],
  }
  if (e.duration_source.endsWith('default2h')) out.assumed = true
  if (e.method === 'vision') out.vision = true
  examIndex.set(id, out)
  course.exams.push(out)
}

const notes = rows<{ code: string; subject: string | null; detail: string }>(db, `
  SELECT code, subject, detail FROM diagnostic
  WHERE severity = 'warn' AND code IN ('ROOM_CONFLICT', 'AMBIGUOUS_SPAN', 'FUZZY_LOW_CONFIDENCE', 'EXPLICIT_OUTSIDE_SLOT')
`)

const bundle = {
  schemaVersion: 1,
  builtAt: new Date().toISOString(),
  academicYear: '2026-27',
  assumptions: { defaultExamMinutes: DEFAULT_EXAM_MINUTES },
  examWindow: EXAM_WINDOW,
  programmes: loadProgrammes().programmes.map((p) => ({
    code: p.code,
    short: p.short,
    name: p.name,
    lang: p.lang,
    colour: p.colour,
  })),
  courses: [...byKey.values()]
    .filter((c) => c.sessions.length > 0 || c.exams.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name)),
  notes: notes.map((n) => ({
    code: n.code,
    text: n.subject ? `${n.subject}: ${n.detail}` : n.detail,
  })),
}

db.close()

mkdirSync(dirname(BUNDLE_PATH), { recursive: true })
const json = JSON.stringify(bundle)
writeFileSync(BUNDLE_PATH, json)

const kb = (n: number): string => `${(n / 1024).toFixed(1)} kB`
console.log(
  `${bundle.courses.length} courses · ` +
  `${bundle.courses.reduce((n, c) => n + c.sessions.length, 0)} sessions · ` +
  `${bundle.courses.reduce((n, c) => n + c.exams.length, 0)} exams · ` +
  `${bundle.notes.length} notes`,
)
console.log(`public/bundle.json — ${kb(json.length)}`)
