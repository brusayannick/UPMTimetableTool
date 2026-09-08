import { useEffect, useRef } from 'react'
import { fmtDate, fmtRange, progColour, WEEKDAYS } from './format.ts'
import type { Course, CourseDetails as DetailsRow, Semester } from '../data/types.ts'

export type CourseDetailsProps = {
  course: Course
  semesters: Semester[]
  onClose: () => void
}

const FIELD_LABELS: [keyof DetailsRow, string][] = [
  ['plans', 'Plan'],
  ['codes', 'Course code'],
  ['name', 'Spanish name'],
  ['englishName', 'English name'],
  ['year', 'Year'],
  ['credits', 'Credits (ECTS)'],
  ['language', 'Language'],
  ['taughtIn', 'Teaching language'],
  ['semester', 'Semester'],
  ['group', 'Group'],
  ['level', 'Level'],
  ['quota', 'Quota'],
  ['learningGuide', 'Learning guide'],
  ['observations', 'Observations'],
]

function DetailTable({ row, index }: { row: DetailsRow; index: number }) {
  const fields = FIELD_LABELS.filter(([k]) => (row[k] ?? '').trim() !== '')
  return (
    <div>
      {index > 0 && (
        <p className="mt-3 mb-1 text-[11px] font-medium" style={{ color: 'var(--text-dim)' }}>
          Also listed as
        </p>
      )}
      <dl className="overflow-hidden rounded-md border text-[12px]" style={{ borderColor: 'var(--line)' }}>
        {fields.map(([key, label], i) => (
          <div
            key={key}
            className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-2 px-2.5 py-1.5"
            style={{ background: i % 2 === 0 ? 'var(--surface-sunken)' : undefined }}
          >
            <dt style={{ color: 'var(--text-faint)' }}>{label}</dt>
            <dd className="min-w-0 break-words whitespace-pre-line">
              {key === 'learningGuide' ? <Linkified value={row[key]} /> : row[key]}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

/** Render each URL on its own line as a link; anything else stays plain text. */
function Linkified({ value }: { value: string }) {
  const parts = value.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return null
  return (
    <>
      {parts.map((part, i) => (
        <span key={i} className="block">
          {/^https?:\/\//.test(part) ? (
            <a
              href={part}
              target="_blank"
              rel="noreferrer"
              className="underline"
              style={{ color: 'var(--text)' }}
            >
              {part}
            </a>
          ) : (
            part
          )}
        </span>
      ))}
    </>
  )
}

export function CourseDetails({ course, semesters, onClose }: CourseDetailsProps) {
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const slots = course.sessions
    .filter((s) => semesters.includes(s.sem))
    .sort((a, b) => a.d - b.d || a.s - b.s)
  const exams = [...course.exams].sort((a, b) => a.date.localeCompare(b.date) || a.s - b.s)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'color-mix(in oklab, black 45%, transparent)' }}
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Details for ${course.name}`}
        className="panel flex max-h-full w-full max-w-lg flex-col overflow-hidden"
        style={{ background: 'var(--surface-raised, var(--surface))' }}
        onClick={(ev) => ev.stopPropagation()}
      >
        <div
          className="flex shrink-0 items-start gap-2 border-b px-4 py-3"
          style={{ borderColor: 'var(--line)' }}
        >
          <div className="min-w-0 flex-1">
            <h2 className="text-[14px] font-semibold leading-snug">{course.name}</h2>
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
              {course.elective && <span>elective</span>}
            </div>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label={`Close details for ${course.name}`}
            className="shrink-0 rounded px-1.5 py-0.5 text-[15px] leading-none"
            style={{ color: 'var(--text-dim)' }}
          >
            ×
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <h3 className="mb-1 text-[11px] font-semibold tracking-wide uppercase" style={{ color: 'var(--text-dim)' }}>
            Timetable
          </h3>
          {slots.length === 0 ? (
            <p className="text-[12px]" style={{ color: 'var(--text-faint)' }}>
              No sessions in the active semesters.
            </p>
          ) : (
            <ul className="flex flex-col gap-1 text-[12px]">
              {slots.map((s, i) => (
                <li key={i} className="tabular-nums">
                  {WEEKDAYS.find((w) => w.n === s.d)?.label} {fmtRange(s.s, s.e)}
                  {s.room && <span style={{ color: 'var(--text-dim)' }}> · Room {s.room}</span>}
                  <span style={{ color: 'var(--text-faint)' }}>
                    {' '}
                    · {s.prog} {s.sem}
                    {s.v && ` · ${s.v.label}`}
                    {s.inferred && ' · inferred span'}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <h3 className="mt-4 mb-1 text-[11px] font-semibold tracking-wide uppercase" style={{ color: 'var(--text-dim)' }}>
            January exam
          </h3>
          {exams.length === 0 ? (
            <p className="text-[12px]" style={{ color: 'var(--text-faint)' }}>
              No January exam.
            </p>
          ) : (
            <ul className="flex flex-col gap-1 text-[12px] tabular-nums">
              {exams.map((e) => (
                <li key={`${e.date}-${e.s}`}>
                  {fmtDate(e.date)} {fmtRange(e.s, e.e, e.assumed)}
                  {e.room && <span style={{ color: 'var(--text-dim)' }}> · Room {e.room}</span>}
                  {e.assumed && <span style={{ color: 'var(--text-faint)' }}> · assumed 2-hour duration</span>}
                </li>
              ))}
            </ul>
          )}

          {course.details && course.details.length > 0 && (
            <>
              <h3 className="mt-4 mb-1 text-[11px] font-semibold tracking-wide uppercase" style={{ color: 'var(--text-dim)' }}>
                Course catalogue
              </h3>
              <p className="mb-2 text-[11.5px]" style={{ color: 'var(--text-faint)' }}>
                From the ETSIINF incoming-student course list.
              </p>
              <div className="flex flex-col gap-2">
                {course.details.map((row, i) => (
                  <DetailTable key={i} row={row} index={i} />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
