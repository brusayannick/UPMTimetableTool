/**
 * Stage 5: prove the scrape is correct, not merely plausible.
 *
 * Six checks, in order of how much they actually prove:
 *
 *   A  every PDF on disk is accounted for — nothing silently skipped
 *   B  per-file counts match the frozen expectations
 *   C  each programme's course and exam sets reconcile
 *   D  the T3 column inference matches the ground-truth screenshot of the same
 *      timetable, printed with explicit times
 *   E  the month-calendar view agrees with the DSC exam grid — which also proves the
 *      per-font ToUnicode path works, since that file is unreadable without it
 *   F  courses taught in several programmes get the same exam date and time from every
 *      file that prints them. This is the strongest evidence available: independently
 *      written parsers over unrelated page layouts converging on one answer.
 *
 *   node scripts/validate.ts             fail on errors
 *   node scripts/validate.ts --strict    fail on warnings too (used in CI)
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { loadExpectations, loadSources } from './lib/curation.ts'
import { openDb, rows } from './lib/db.ts'
import { DB_PATH, EXTRACTED_DIR, INPUT_DIRS, PARSED_DIR, REPORTS_DIR, VISION_DIR, relPath, slugFor } from './lib/paths.ts'
import { fmtMin, WEEKDAY_LABELS } from './lib/time.ts'
import type { ParsedArtefact, ParsedTimetable, Severity, VisionArtefact } from './lib/types.ts'

const strict = process.argv.includes('--strict')

const findings: { severity: Severity; code: string; detail: string }[] = []
const fail = (code: string, detail: string): void => void findings.push({ severity: 'error', code, detail })
const warn = (code: string, detail: string): void => void findings.push({ severity: 'warn', code, detail })

const L: string[] = ['# Verification report', '']
const say = (line = ''): void => {
  L.push(line)
  console.log(line)
}

const sources = loadSources()
const expectations = loadExpectations()
const db = openDb(DB_PATH)

const parsed = new Map<string, ParsedArtefact>()
for (const file of readdirSync(PARSED_DIR)) {
  if (!file.endsWith('.json')) continue
  const art = JSON.parse(readFileSync(join(PARSED_DIR, file), 'utf8')) as ParsedArtefact
  parsed.set(art.sourcePath, art)
}

// ── A. source accounting ────────────────────────────────────────────────────

say('## A · Source accounting')
say()

const onDisk: string[] = []
for (const dir of INPUT_DIRS) {
  for (const name of readdirSync(dir)) {
    // NFC: macOS returns NFD filenames while the curation JSON is NFC.
    if (name.toLowerCase().endsWith('.pdf')) onDisk.push(relPath(join(dir, name)).normalize('NFC'))
  }
}

const declared = new Map(sources.map((s) => [s.path.normalize('NFC'), s.path]))
for (const path of onDisk) {
  if (!declared.has(path)) {
    fail('UNACCOUNTED_SOURCE', `${path} is on disk but not declared in data/curation/sources.json`)
  }
}
for (const spec of sources) {
  if (!onDisk.includes(spec.path.normalize('NFC'))) fail('MISSING_SOURCE', `${spec.path} is declared but not on disk`)
}

const manifest = JSON.parse(readFileSync(join(EXTRACTED_DIR, '_manifest.json'), 'utf8')) as {
  files: Record<string, { sha256: string }>
}
const sourceRows = rows<{ path: string; sha256: string; role: string; layout_family: string; extraction_method: string }>(
  db, 'SELECT path, sha256, role, layout_family, extraction_method FROM source_file',
)
for (const r of sourceRows) {
  const expected = manifest.files[slugFor(r.path)]?.sha256
  if (expected && expected !== r.sha256) {
    fail('SHA_MISMATCH', `${r.path}: database sha256 differs from the extraction manifest`)
  }
}

// A transcribed source must be re-read if the underlying image changes.
for (const spec of sources) {
  if (!spec.vision) continue
  const art = JSON.parse(readFileSync(join(VISION_DIR, spec.vision), 'utf8')) as VisionArtefact
  const actual = manifest.files[slugFor(spec.path)]?.sha256
  if (actual && art.extractor.sourceSha256 !== actual) {
    fail(
      'STALE_VISION',
      `${spec.vision} was transcribed from sha256 ${art.extractor.sourceSha256.slice(0, 12)}… but ` +
      `${basename(spec.path)} is now ${actual.slice(0, 12)}… — re-transcribe it`,
    )
  }
}

const byRole = (role: string): number => sources.filter((s) => s.role === role).length
say(`${onDisk.length} PDFs on disk · ${byRole('primary')} primary · ${byRole('crosscheck')} cross-check · ${byRole('out-of-scope')} deliberately excluded`)
say()
for (const s of sources.filter((s) => s.role === 'out-of-scope')) {
  say(`- excluded: \`${s.path}\``)
}
say()

// ── B. per-file counts ──────────────────────────────────────────────────────

say('## B · Per-file counts against frozen expectations')
say()
say('| file | metric | expected | actual |')
say('|---|---|---|---|')

for (const [path, want] of Object.entries(expectations.files)) {
  const art = parsed.get(path)
  if (!art) {
    fail('EXPECTATION_NO_PARSE', `${path} has expectations but no parsed artefact`)
    continue
  }
  const actual: Record<string, number> = art.kind === 'timetable'
    ? { courses: art.sessions.length, filler: art.fillerCount }
    : { exams: art.exams.length }

  for (const [metric, expected] of Object.entries(want)) {
    if (metric.startsWith('$')) continue
    const got = actual[metric]
    const ok = got === expected
    say(`| ${basename(path)} | ${metric} | ${expected} | ${got}${ok ? '' : ' ⚠'} |`)
    if (!ok) fail('EXPECTATION_MISMATCH', `${path}: ${metric} expected ${expected}, got ${got}`)
  }
}
say()

// ── C. programme balance ────────────────────────────────────────────────────

say('## C · Programme balance')
say()
say('| programme | courses | with a session | with an exam | reconciliation |')
say('|---|---|---|---|---|')

type Bal = { code: string; courses: number; withSession: number; withExam: number }
const balances = rows<Bal>(db, `
  SELECT p.code,
         COUNT(DISTINCT c.id) AS courses,
         COUNT(DISTINCT CASE WHEN s.id IS NOT NULL THEN c.id END) AS withSession,
         COUNT(DISTINCT CASE WHEN e.id IS NOT NULL THEN c.id END) AS withExam
  FROM programme p
  JOIN course c ON c.programme_id = p.id
  LEFT JOIN session s ON s.course_id = c.id
  LEFT JOIN exam e ON e.course_id = c.id
  GROUP BY p.id ORDER BY p.code
`)

for (const b of balances) {
  const examless = expectations.examlessCourses.filter((x) => x.programme === b.code).length
  const sessionless = expectations.sessionlessCourses.filter((x) => x.programme === b.code).length
  const orphan = expectations.orphanExams.filter((x) => x.programme === b.code).length

  const notes: string[] = []
  if (examless) notes.push(`−${examless} declared exam-less`)
  if (sessionless) notes.push(`+${sessionless} declared session-only`)
  if (orphan) notes.push(`+${orphan} declared orphan exam`)

  // Orphan exams never became course rows (they have no timetable counterpart), so
  // they cannot offset this count — they are reported separately.
  const unexplainedExamless = b.courses - b.withExam - examless
  const unexplainedSessionless = b.courses - b.withSession - sessionless

  const verdict = unexplainedExamless === 0 && unexplainedSessionless === 0
    ? notes.length ? notes.join(', ') : 'exact'
    : `unexplained: ${unexplainedExamless} without an exam, ${unexplainedSessionless} without a session`

  say(`| ${b.code} | ${b.courses} | ${b.withSession} | ${b.withExam} | ${verdict} |`)

  if (unexplainedExamless !== 0) {
    const list = rows<{ name: string }>(db, `
      SELECT c.display_name AS name FROM course c JOIN programme p ON p.id = c.programme_id
      WHERE p.code = ? AND NOT EXISTS (SELECT 1 FROM exam e WHERE e.course_id = c.id)
    `, b.code).map((r) => r.name)
    warn(
      'UNDECLARED_EXAMLESS_COURSE',
      `${b.code}: ${unexplainedExamless} course(s) have no exam and no declaration — ${list.join(', ')}`,
    )
  }
  if (unexplainedSessionless !== 0) {
    const list = rows<{ name: string }>(db, `
      SELECT c.display_name AS name FROM course c JOIN programme p ON p.id = c.programme_id
      WHERE p.code = ? AND NOT EXISTS (SELECT 1 FROM session s WHERE s.course_id = c.id)
    `, b.code).map((r) => r.name)
    fail(
      'UNDECLARED_SESSIONLESS_COURSE',
      `${b.code}: ${unexplainedSessionless} course(s) have no session and no declaration — ${list.join(', ')}`,
    )
  }
}
say()

// ── D. cross-check: the transcribed screenshot vs the inferred columns ──────

say('## D · Column inference against the ground-truth screenshot')
say()

const visionTimetables = sources.filter((s) => s.kind === 'timetable' && s.role === 'crosscheck' && s.vision)
for (const spec of visionTimetables) {
  const truth = parsed.get(spec.path) as ParsedTimetable | undefined
  if (!truth) continue

  const derived = rows<{ weekday: number; start_min: number; end_min: number; key: string; span_source: string }>(db, `
    SELECT s.weekday, s.start_min, s.end_min, c.canonical_key AS key, s.span_source
    FROM session s
    JOIN course c ON c.id = s.course_id
    JOIN programme p ON p.id = c.programme_id
    JOIN semester sem ON sem.id = s.semester_id
    JOIN source_file sf ON sf.id = s.source_file_id
    WHERE p.code = ? AND sem.code = ? AND sf.role = 'primary' AND sf.extraction_method = 'pdfjs'
    ORDER BY s.weekday, s.start_min
  `, spec.programme!, spec.semester!)

  say(`\`${basename(spec.path)}\` → ${spec.programme} ${spec.semester}`)
  say()
  say('| weekday | from the text PDF | from the screenshot | |')
  say('|---|---|---|---|')

  // Compare the evening grid only: the screenshot covers the afternoon.
  const truthBlocks = truth.sessions.filter((s) => s.startMin >= 900)
  let hits = 0
  for (const t of truthBlocks) {
    const match = derived.find(
      (d) => d.weekday === t.weekday && d.start_min === t.startMin && d.end_min === t.endMin,
    )
    if (match) hits++
    else {
      const sameDay = derived
        .filter((d) => d.weekday === t.weekday)
        .map((d) => `${fmtMin(d.start_min)}–${fmtMin(d.end_min)}`)
        .join(', ')
      fail(
        'CROSSCHECK_SPAN_MISMATCH',
        `${spec.programme} ${spec.semester} ${WEEKDAY_LABELS[t.weekday]} ${fmtMin(t.startMin)}–${fmtMin(t.endMin)} ` +
        `(${t.rawName}) has no counterpart in the text-derived spans [${sameDay}]`,
      )
    }
    say(
      `| ${WEEKDAY_LABELS[t.weekday]} | ${match ? `${fmtMin(match.start_min)}–${fmtMin(match.end_min)} (${match.span_source})` : '—'} ` +
      `| ${fmtMin(t.startMin)}–${fmtMin(t.endMin)} | ${match ? '✓' : '✗'} |`,
    )
  }
  say()
  say(`**${hits}/${truthBlocks.length}** inferred spans match the printed times.`)
  say()
}

// ── E. cross-check: the month-calendar view ─────────────────────────────────

say('## E · Month-calendar view against the exam grid')
say()
say('This is also the proof that the per-font `ToUnicode` path works: without CMap')
say('resolution the source file yields `!"#$"%&\'()` instead of course names.')
say()

const calendarSources = sources.filter((s) => s.layoutFamily === 'E-e')
for (const spec of calendarSources) {
  const cal = parsed.get(spec.path)
  if (!cal || cal.kind !== 'exam') continue

  const witnessed = rows<{ raw_name: string; date: string; start_min: number; grid_date: string; grid_start: number; name: string }>(db, `
    SELECT w.raw_name, w.date, w.start_min, e.date AS grid_date, e.start_min AS grid_start, c.display_name AS name
    FROM exam_witness w
    JOIN source_file sf ON sf.id = w.source_file_id
    JOIN exam e ON e.id = w.exam_id
    JOIN course c ON c.id = e.course_id
    WHERE sf.path = ?
  `, spec.path)

  say(`| printed in the calendar | calendar | exam grid | |`)
  say('|---|---|---|---|')
  for (const w of witnessed) {
    const ok = w.date === w.grid_date && w.start_min === w.grid_start
    say(`| ${w.name} | ${w.date} ${fmtMin(w.start_min)} | ${w.grid_date} ${fmtMin(w.grid_start)} | ${ok ? '✓' : '✗'} |`)
    if (!ok) {
      fail('CALENDAR_DISAGREEMENT', `${w.name}: calendar says ${w.date} ${fmtMin(w.start_min)}, grid says ${w.grid_date} ${fmtMin(w.grid_start)}`)
    }
  }
  const total = cal.exams.length
  say()
  say(
    `**${witnessed.length}/${total}** calendar entries corroborate a grid exam. The remainder list ` +
    `courses absent from the ${spec.programme} timetable, so they cannot be joined — reported as ` +
    `\`CROSSCHECK_ONLY_EXAM\` warnings rather than treated as defects.`,
  )
  say()
}

// ── F. cross-programme exam agreement ───────────────────────────────────────

say('## F · Shared-exam agreement across programmes')
say()
say('Courses taught in more than one programme appear in several exam calendars, each')
say('printed in a different layout and parsed by a different code path. Every one of')
say('them has to give the same answer.')
say()

type ExamRow = { key: string; name: string; prog: string; fam: string; date: string; start_min: number }
const examRows = rows<ExamRow>(db, `
  SELECT c.canonical_key AS key, c.display_name AS name, p.code AS prog,
         sf.layout_family AS fam, e.date, e.start_min
  FROM exam e
  JOIN course c ON c.id = e.course_id
  JOIN programme p ON p.id = c.programme_id
  JOIN source_file sf ON sf.id = e.source_file_id
  ORDER BY c.canonical_key, p.code
`)

const grouped = new Map<string, ExamRow[]>()
for (const r of examRows) {
  const list = grouped.get(r.key)
  if (list) list.push(r)
  else grouped.set(r.key, [r])
}

let sharedCount = 0
let agreeCount = 0
say('| course | asserted by | date | time | |')
say('|---|---|---|---|---|')
for (const list of [...grouped.values()].sort((a, b) => a[0]!.name.localeCompare(b[0]!.name))) {
  const progs = new Set(list.map((r) => r.prog))
  if (progs.size < 2) continue
  sharedCount++
  const stamps = new Set(list.map((r) => `${r.date} ${r.start_min}`))
  const ok = stamps.size === 1
  if (ok) agreeCount++
  else {
    fail(
      'WITNESS_DISAGREEMENT',
      `${list[0]!.name}: ${list.map((r) => `${r.prog} says ${r.date} ${fmtMin(r.start_min)}`).join(', ')}`,
    )
  }
  say(
    `| ${list[0]!.name} | ${list.map((r) => `${r.prog}/${r.fam}`).join(' · ')} | ${list[0]!.date} ` +
    `| ${fmtMin(list[0]!.start_min)} | ${ok ? '✓' : '✗'} |`,
  )
}
say()
say(`**${agreeCount}/${sharedCount}** courses shared across programmes agree on date and start time.`)
say()

const families = new Set(examRows.map((r) => r.fam))
say(`Layout families contributing exam data: ${[...families].sort().join(', ')}.`)
say()

// ── assumptions and diagnostics ─────────────────────────────────────────────

say('## Assumptions in the data')
say()
const assumed = rows<{ n: number; src: string }>(db, `
  SELECT COUNT(*) AS n, duration_source AS src FROM exam GROUP BY duration_source ORDER BY n DESC
`)
const totalExams = assumed.reduce((s, a) => s + a.n, 0)
say('| duration source | exams |')
say('|---|---|')
for (const a of assumed) say(`| \`${a.src}\` | ${a.n} |`)
say()
const assumedN = assumed.filter((a) => a.src.endsWith('default2h')).reduce((s, a) => s + a.n, 0)
say(
  `${assumedN} of ${totalExams} exams have an end time the source does not print; they are given a ` +
  `**2-hour** duration and flagged so the UI shows them as an assumption. An exam collision that ` +
  `exists only because of an assumed tail is shown as *possible* rather than *certain*.`,
)
say()

const inferred = rows<{ n: number }>(db, `SELECT COUNT(*) AS n FROM session WHERE span_source = 'inferred'`)[0]!.n
const totalSessions = rows<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM session')[0]!.n
say(
  `${inferred} of ${totalSessions} sessions have a start/end derived from text position rather than ` +
  `from a printed cell rectangle. Check D above is what keeps that honest.`,
)
say()

for (const d of rows<{ severity: Severity; code: string; subject: string | null; detail: string }>(
  db, `SELECT severity, code, subject, detail FROM diagnostic WHERE severity IN ('error','warn')`,
)) {
  findings.push({
    severity: d.severity,
    code: d.code,
    detail: `${d.subject ? `${d.subject} — ` : ''}${d.detail}`,
  })
}

db.close()

// ── verdict ─────────────────────────────────────────────────────────────────

const errors = findings.filter((f) => f.severity === 'error')
const warns = findings.filter((f) => f.severity === 'warn')

say('## Verdict')
say()
for (const sev of ['error', 'warn'] as const) {
  const list = findings.filter((f) => f.severity === sev)
  say(`### ${sev} (${list.length})`)
  say()
  if (list.length === 0) say('_none_')
  else for (const f of list) say(`- \`${f.code}\` ${f.detail}`)
  say()
}

writeFileSync(join(REPORTS_DIR, 'crosscheck-report.md'), `${L.join('\n')}\n`)

console.log(`\n${errors.length} errors · ${warns.length} warnings · report: data/reports/crosscheck-report.md`)
if (errors.length > 0 || (strict && warns.length > 0)) process.exit(1)
