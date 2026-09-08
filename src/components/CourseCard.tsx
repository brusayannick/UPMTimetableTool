import { courseDragId, useDraggable } from './dnd.ts'
import { fmtDate, fmtRange, progColour, WEEKDAYS } from './format.ts'
import type { Course, Semester } from '../data/types.ts'

export type CourseCardProps = {
  course: Course
  inPlan: boolean
  clashing: boolean
  semesters: Semester[]
  onToggle: (key: string) => void
  onDetails: (key: string) => void
}

export function CourseCard({ course, inPlan, clashing, semesters, onToggle, onDetails }: CourseCardProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: courseDragId(course.key),
    data: { type: 'course', key: course.key },
  })

  // One row per distinct slot: a course offered by three programmes has three
  // identical entries in the data, but the student attends it once.
  const slots = [
    ...new Map(
      course.sessions
        .filter((s) => semesters.includes(s.sem))
        .map((s) => [`${s.d}|${s.s}|${s.e}`, s]),
    ).values(),
  ].sort((a, b) => a.d - b.d || a.s - b.s)
  const accent = progColour(course.progs[0] ?? '')
  const exams = [...course.exams].sort((a, b) => a.date.localeCompare(b.date) || a.s - b.s)
  const hasDetails = !!course.details && course.details.length > 0

  return (
    <li
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onDoubleClick={(ev) => {
        // Buttons handle their own clicks; a double-click elsewhere opens details.
        if ((ev.target as HTMLElement).closest('button')) return
        if (hasDetails) onDetails(course.key)
      }}
      className="group relative cursor-grab rounded-lg border px-2.5 py-2 transition-colors"
      style={{
        borderColor: clashing ? 'var(--danger)' : 'var(--line)',
        background: inPlan ? 'var(--surface-sunken)' : 'var(--surface)',
        opacity: isDragging ? 0.4 : 1,
      }}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          aria-pressed={inPlan}
          aria-label={inPlan ? `Remove ${course.name} from the plan` : `Add ${course.name} to the plan`}
          onPointerDown={(ev) => ev.stopPropagation()}
          onClick={(ev) => {
            ev.stopPropagation()
            onToggle(course.key)
          }}
          className="mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[11px] leading-none"
          style={{
            borderColor: inPlan ? accent : 'var(--line-strong)',
            background: inPlan ? accent : 'transparent',
            color: inPlan ? 'var(--surface)' : 'var(--text-faint)',
          }}
        >
          {inPlan ? '✓' : '+'}
        </button>
        {hasDetails && (
          <button
            type="button"
            aria-label={`Show details for ${course.name}`}
            title="Course details"
            onPointerDown={(ev) => ev.stopPropagation()}
            onClick={(ev) => {
              ev.stopPropagation()
              onDetails(course.key)
            }}
            className="mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[11px] leading-none"
            style={{ borderColor: 'var(--line-strong)', color: 'var(--text-faint)' }}
          >
            i
          </button>
        )}

        <div className="min-w-0 flex-1">
          <div
            className="text-[12.5px] font-medium leading-snug"
            style={{ color: inPlan ? 'var(--text-dim)' : 'var(--text)' }}
          >
            {course.name}
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-1 text-[10.5px]" style={{ color: 'var(--text-faint)' }}>
            {course.progs.map((p) => (
              <span
                key={p}
                className="rounded px-1 py-px"
                style={{ color: progColour(p), background: `color-mix(in oklab, ${progColour(p)} 12%, transparent)` }}
              >
                {p}
              </span>
            ))}
            {course.elective && <span className="rounded px-1 py-px" style={{ background: 'var(--surface-sunken)' }}>elective</span>}
            {slots.length > 0 && (
              <span>
                {slots.length} {slots.length === 1 ? 'session' : 'sessions'}
              </span>
            )}
          </div>

          {slots.length > 0 && (
            <div className="mt-1 text-[10.5px] tabular-nums" style={{ color: 'var(--text-faint)' }}>
              {slots.slice(0, 3).map((s, i) => (
                <span key={i}>
                  {i > 0 && ' · '}
                  {WEEKDAYS.find((w) => w.n === s.d)?.short} {fmtRange(s.s, s.e)}
                </span>
              ))}
              {slots.length > 3 && ` · +${slots.length - 3}`}
            </div>
          )}

          <div className="mt-1 flex flex-wrap items-center gap-1 text-[10.5px]">
            {exams.length === 0 ? (
              <span style={{ color: 'var(--text-faint)' }}>no January exam</span>
            ) : (
              exams.map((e) => (
                <span
                  key={`${e.date}-${e.s}`}
                  className="tabular-nums"
                  style={{ color: clashing ? 'var(--danger)' : 'var(--text-dim)' }}
                  title={
                    e.assumed
                      ? 'The source prints only a start time; the end is assumed 2 hours later.'
                      : 'Start and end are both printed in the source.'
                  }
                >
                  {fmtDate(e.date)} {fmtRange(e.s, e.e, e.assumed)}
                </span>
              ))
            )}
          </div>
        </div>
      </div>
    </li>
  )
}
