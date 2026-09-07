import { fmtDate, fmtRange, progColour, weekdaysBetween } from './format.ts'
import type { Bundle, PlacedExam } from '../data/types.ts'
import type { ExamCollision } from '../state/collisions.ts'

/** The exam period runs 09:00–21:00; the earliest printed start is 09:00. */
const DAY_START = 9 * 60
const DAY_END = 21 * 60

export type ExamPanelProps = {
  bundle: Bundle
  exams: PlacedExam[]
  collisions: ExamCollision[]
}

export function ExamPanel({ bundle, exams, collisions }: ExamPanelProps) {
  const days = weekdaysBetween(bundle.examWindow.from, bundle.examWindow.to)

  const severityOf = new Map<string, ExamCollision['severity']>()
  for (const c of collisions) {
    for (const p of [c.a, c.b]) {
      const id = examId(p)
      if (c.severity === 'certain' || !severityOf.has(id)) severityOf.set(id, c.severity)
    }
  }

  const byDate = new Map<string, PlacedExam[]>()
  for (const p of exams) {
    const list = byDate.get(p.exam.date)
    if (list) list.push(p)
    else byDate.set(p.exam.date, [p])
  }

  return (
    <section aria-label="January exam dates" className="panel flex min-h-0 flex-col overflow-hidden">
      <header
        className="shrink-0 border-b px-3 py-2"
        style={{ borderColor: 'var(--line)' }}
      >
        <h2 className="text-[12px] font-semibold">January exams</h2>
        <p className="mt-0.5 text-[11px]" style={{ color: 'var(--text-dim)' }}>
          {exams.length === 0
            ? 'Add courses to see their exam dates.'
            : `${exams.length} ${exams.length === 1 ? 'exam' : 'exams'} · ${describe(collisions)}`}
        </p>
      </header>

      {collisions.length > 0 && (
        <ul className="shrink-0 border-b px-3 py-2 text-[11px]" style={{ borderColor: 'var(--line)' }}>
          {collisions.map((c, i) => (
            <li
              key={i}
              className="mb-1.5 rounded-md px-2 py-1.5 last:mb-0"
              style={{
                background: c.severity === 'certain' ? 'var(--danger-bg)' : 'var(--caution-bg)',
                color: c.severity === 'certain' ? 'var(--danger)' : 'var(--caution)',
              }}
            >
              <div className="font-medium">
                {c.severity === 'certain' ? 'Clash' : 'Possible clash'} · {fmtDate(c.date)}
              </div>
              <div className="mt-0.5" style={{ color: 'var(--text)' }}>
                {c.a.course.name} <span style={{ color: 'var(--text-faint)' }}>{fmtRange(c.a.exam.s, c.a.exam.e, c.a.exam.assumed)}</span>
                {' · '}
                {c.b.course.name} <span style={{ color: 'var(--text-faint)' }}>{fmtRange(c.b.exam.s, c.b.exam.e, c.b.exam.assumed)}</span>
              </div>
              {c.because && (
                <div className="mt-0.5 text-[10.5px]" style={{ color: 'var(--text-dim)' }}>
                  {c.because}.
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {exams.length === 0 ? (
          <p className="py-8 text-center text-[12px]" style={{ color: 'var(--text-faint)' }}>
            Nothing selected yet.
          </p>
        ) : (
          <ol className="flex flex-col gap-2">
            {days
              .filter((d) => byDate.has(d))
              .map((date) => (
                <li key={date}>
                  <div
                    className="mb-1 text-[11px] font-medium uppercase tracking-wide"
                    style={{ color: 'var(--text-dim)' }}
                  >
                    {fmtDate(date)}
                  </div>
                  <div className="flex flex-col gap-1">
                    {byDate
                      .get(date)!
                      .sort((a, b) => a.exam.s - b.exam.s)
                      .map((p) => (
                        <ExamBar key={examId(p)} placed={p} severity={severityOf.get(examId(p))} />
                      ))}
                  </div>
                </li>
              ))}
          </ol>
        )}
      </div>

      <footer
        className="shrink-0 border-t px-3 py-2 text-[10.5px]"
        style={{ borderColor: 'var(--line)', color: 'var(--text-faint)' }}
      >
        <span className="tabular-nums">~</span> before an end time means the source prints only a start;{' '}
        {bundle.assumptions.defaultExamMinutes / 60} hours is assumed.
      </footer>
    </section>
  )
}

function ExamBar({ placed, severity }: { placed: PlacedExam; severity: ExamCollision['severity'] | undefined }) {
  const { course, exam } = placed
  const accent = progColour(exam.progs[0] ?? course.progs[0] ?? '')
  const left = ((exam.s - DAY_START) / (DAY_END - DAY_START)) * 100
  const width = Math.max(4, ((exam.e - exam.s) / (DAY_END - DAY_START)) * 100)

  const tone =
    severity === 'certain' ? 'var(--danger)' : severity === 'possible' ? 'var(--caution)' : accent

  return (
    <div
      title={[
        course.name,
        `${fmtDate(exam.date)} ${fmtRange(exam.s, exam.e, exam.assumed)}`,
        exam.slot ? `printed window ${exam.slot}` : null,
        exam.room ? `Room ${exam.room}` : null,
        exam.assumed
          ? 'End time is not printed in the source; assuming 2 hours.'
          : 'Start and end are both printed in the source.',
        exam.witnesses > 1 ? `Confirmed by ${exam.witnesses} independent source files.` : null,
      ].filter(Boolean).join('\n')}
    >
      <div className="flex items-baseline gap-1.5">
        <span className="min-w-0 flex-1 truncate text-[11.5px]" style={{ color: 'var(--text)' }}>
          {severity && (
            <span aria-hidden style={{ color: tone }}>
              {severity === 'certain' ? '⚠ ' : '· '}
            </span>
          )}
          {course.name}
        </span>
        <span className="shrink-0 text-[10.5px] tabular-nums" style={{ color: 'var(--text-dim)' }}>
          {fmtRange(exam.s, exam.e, exam.assumed)}
        </span>
      </div>

      <div className="relative mt-0.5 h-1.5 rounded-full" style={{ background: 'var(--surface-sunken)' }}>
        <div
          className="absolute top-0 h-full rounded-full"
          style={{
            left: `${left}%`,
            width: `${width}%`,
            background: tone,
            // A dashed right edge marks the part of the bar that is an assumption
            // rather than a printed value.
            ...(exam.assumed
              ? {
                  background: `linear-gradient(to right, ${tone} 0%, ${tone} 45%, color-mix(in oklab, ${tone} 35%, transparent) 100%)`,
                }
              : {}),
          }}
        />
      </div>
    </div>
  )
}

const examId = (p: PlacedExam): string => `${p.course.key}|${p.exam.date}|${p.exam.s}`

function describe(collisions: ExamCollision[]): string {
  if (collisions.length === 0) return 'no clashes'
  const certain = collisions.filter((c) => c.severity === 'certain').length
  const possible = collisions.length - certain
  const parts: string[] = []
  if (certain) parts.push(`${certain} ${certain === 1 ? 'clash' : 'clashes'}`)
  if (possible) parts.push(`${possible} possible`)
  return parts.join(', ')
}
