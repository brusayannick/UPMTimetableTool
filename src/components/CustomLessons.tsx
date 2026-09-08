import { useState } from 'react'
import { fmtMin, fmtRange, WEEKDAYS } from './format.ts'
import {
  CUSTOM_DAY_END,
  CUSTOM_DAY_START,
  CUSTOM_NAME_MAX,
  CUSTOM_ROOM_MAX,
  CUSTOM_STEP,
  parseTimeInput,
  type CustomLesson,
} from '../state/custom.ts'

export type CustomLessonsProps = {
  lessons: CustomLesson[]
  onAdd: (lesson: Omit<CustomLesson, 'id'>) => void
  onRemove: (id: string) => void
}

const inputStyle = {
  borderColor: 'var(--line-strong)',
  background: 'var(--surface)',
  color: 'var(--text)',
} as const

/** Validate the form. Returns the lesson (without id) or an error message. */
function validate(
  name: string,
  day: string,
  start: string,
  end: string,
  room: string,
): { lesson: Omit<CustomLesson, 'id'> } | { error: string } {
  const trimmed = name.trim()
  if (!trimmed) return { error: 'Give the lesson a name.' }
  const d = Number(day)
  if (!Number.isInteger(d) || d < 1 || d > 5) return { error: 'Pick a weekday.' }
  const s = parseTimeInput(start)
  const e = parseTimeInput(end)
  if (s === null || e === null) return { error: 'Enter start and end times.' }
  if (s >= e) return { error: 'The end must be after the start.' }
  if (s < CUSTOM_DAY_START || e > CUSTOM_DAY_END) {
    return { error: `Lessons must fit ${fmtMin(CUSTOM_DAY_START)}–${fmtMin(CUSTOM_DAY_END)}.` }
  }
  if (s % CUSTOM_STEP !== 0 || e % CUSTOM_STEP !== 0) {
    return { error: 'Times snap to 30 minutes.' }
  }
  return {
    lesson: {
      name: trimmed.slice(0, CUSTOM_NAME_MAX),
      day: d as CustomLesson['day'],
      start: s,
      end: e,
      room: room.trim() ? room.trim().slice(0, CUSTOM_ROOM_MAX) : null,
    },
  }
}

export function CustomLessons({ lessons, onAdd, onRemove }: CustomLessonsProps) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [day, setDay] = useState('1')
  const [start, setStart] = useState('18:00')
  const [end, setEnd] = useState('19:30')
  const [room, setRoom] = useState('')
  const [error, setError] = useState<string | null>(null)

  const submit = (): void => {
    const result = validate(name, day, start, end, room)
    if ('error' in result) {
      setError(result.error)
      return
    }
    onAdd(result.lesson)
    setName('')
    setRoom('')
    setError(null)
  }

  return (
    <section aria-label="Custom lessons" className="shrink-0 border-b px-3 pt-2.5 pb-2.5" style={{ borderColor: 'var(--line)' }}>
      <div className="flex items-center gap-2">
        <h2 className="text-[11px] font-semibold tracking-wide uppercase" style={{ color: 'var(--text-dim)' }}>
          Custom{lessons.length > 0 && ` · ${lessons.length}`}
        </h2>
        <button
          type="button"
          className="chip ml-auto"
          aria-expanded={open}
          aria-label={open ? 'Hide the custom lesson form' : 'Show the custom lesson form'}
          onClick={() => {
            setOpen((o) => !o)
            setError(null)
          }}
        >
          {open ? '−' : '+ add'}
        </button>
      </div>

      {open && (
        <form
          className="mt-2 flex flex-col gap-1.5"
          onSubmit={(ev) => {
            ev.preventDefault()
            submit()
          }}
        >
          <input
            type="text"
            value={name}
            onChange={(ev) => setName(ev.target.value)}
            placeholder="Lesson name…"
            aria-label="Lesson name"
            maxLength={CUSTOM_NAME_MAX}
            className="w-full min-w-0 rounded-md border px-2 py-1 text-[12px] outline-none"
            style={inputStyle}
          />
          <div className="flex items-center gap-1.5">
            <select
              value={day}
              onChange={(ev) => setDay(ev.target.value)}
              aria-label="Weekday"
              className="min-w-0 flex-1 rounded-md border px-1 py-1 text-[12px] outline-none"
              style={inputStyle}
            >
              {WEEKDAYS.map((w) => (
                <option key={w.n} value={w.n}>
                  {w.short}
                </option>
              ))}
            </select>
            <input
              type="time"
              value={start}
              onChange={(ev) => setStart(ev.target.value)}
              aria-label="Start time"
              step={CUSTOM_STEP * 60}
              className="w-[5.2rem] rounded-md border px-1 py-1 text-[12px] tabular-nums outline-none"
              style={inputStyle}
            />
            <span aria-hidden style={{ color: 'var(--text-faint)' }}>
              –
            </span>
            <input
              type="time"
              value={end}
              onChange={(ev) => setEnd(ev.target.value)}
              aria-label="End time"
              step={CUSTOM_STEP * 60}
              className="w-[5.2rem] rounded-md border px-1 py-1 text-[12px] tabular-nums outline-none"
              style={inputStyle}
            />
          </div>
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              value={room}
              onChange={(ev) => setRoom(ev.target.value)}
              placeholder="Room (optional)"
              aria-label="Room (optional)"
              maxLength={CUSTOM_ROOM_MAX}
              className="w-full min-w-0 rounded-md border px-2 py-1 text-[12px] outline-none"
              style={inputStyle}
            />
            <button type="submit" className="chip shrink-0" aria-pressed="false">
              Add
            </button>
          </div>
          {error && (
            <p role="alert" className="text-[11.5px]" style={{ color: 'var(--danger)' }}>
              {error}
            </p>
          )}
        </form>
      )}

      {lessons.length > 0 && (
        <ul className="mt-1.5 flex flex-col gap-1">
          {lessons.map((l) => (
            <li
              key={l.id}
              className="flex items-center gap-2 rounded-md border px-2 py-1 text-[12px]"
              style={{ borderColor: 'var(--line)', background: 'var(--surface-sunken)' }}
            >
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium">{l.name}</span>{' '}
                <span className="tabular-nums" style={{ color: 'var(--text-dim)' }}>
                  {WEEKDAYS.find((w) => w.n === l.day)?.short} {fmtRange(l.start, l.end)}
                  {l.room && ` · ${l.room}`}
                </span>
              </span>
              <button
                type="button"
                aria-label={`Remove custom lesson ${l.name}`}
                onClick={() => onRemove(l.id)}
                className="shrink-0 rounded px-1 text-[13px] leading-none"
                style={{ color: 'var(--text-faint)' }}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
