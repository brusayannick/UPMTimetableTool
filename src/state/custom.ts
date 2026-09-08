/**
 * Custom lessons: user-defined weekly time blocks (a language class, a job,
 * sport…) that behave like courses everywhere it matters — they render in the
 * week grid, clash with overlapping catalogue courses, and count for the
 * "fits plan" filter — except they have no January exam.
 *
 * Identity is `custom:<id>` so a custom lesson can never collide with a
 * catalogue key, and the share-hash carries the full definitions (not just the
 * keys) so a shared link reproduces the whole plan.
 */

import type { Weekday } from '../data/types.ts'

export type CustomLesson = {
  id: string
  name: string
  day: Weekday
  /** Minutes since midnight. */
  start: number
  end: number
  room: string | null
}

/** The week grid draws 09:00–21:00; custom lessons must fit inside it. */
export const CUSTOM_DAY_START = 9 * 60
export const CUSTOM_DAY_END = 21 * 60
export const CUSTOM_STEP = 30
export const CUSTOM_NAME_MAX = 60
export const CUSTOM_ROOM_MAX = 20

export const customKey = (id: string): string => `custom:${id}`

const enc = (s: string): string => encodeURIComponent(s).replaceAll('~', '%7E')

/** `lessons → "name|day|start|end|room~…"` for the URL hash. */
export function encodeCustom(lessons: CustomLesson[]): string {
  return lessons
    .map((l) => `${enc(l.name)}|${l.day}|${l.start}|${l.end}|${enc(l.room ?? '')}`)
    .join('~')
}

/**
 * Parse the `c=` hash value back into lessons. Lenient by design: a hand-made
 * link with a broken entry keeps the valid ones and drops the rest, never the
 * whole plan.
 */
export function decodeCustom(value: string): CustomLesson[] {
  const out: CustomLesson[] = []
  for (const [i, part] of value.split('~').entries()) {
    if (!part) continue
    const fields = part.split('|')
    if (fields.length !== 5) continue
    const [nameE, dayS, startS, endS, roomE] = fields as [string, string, string, string, string]
    let name: string
    let room: string
    try {
      name = decodeURIComponent(nameE)
      room = decodeURIComponent(roomE)
    } catch {
      continue
    }
    const day = Number(dayS)
    const start = Number(startS)
    const end = Number(endS)
    if (!name.trim()) continue
    if (!Number.isInteger(day) || day < 1 || day > 5) continue
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < CUSTOM_DAY_START ||
      end > CUSTOM_DAY_END ||
      start >= end
    ) {
      continue
    }
    if (start % CUSTOM_STEP !== 0 || end % CUSTOM_STEP !== 0) continue
    out.push({
      id: `shared-${i}`,
      name: name.trim().slice(0, CUSTOM_NAME_MAX),
      day: day as Weekday,
      start,
      end,
      room: room.trim() ? room.trim().slice(0, CUSTOM_ROOM_MAX) : null,
    })
  }
  return out
}

/** `"18:30"` → 1110. Null when not a valid 24-hour `HH:MM`. */
export function parseTimeInput(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null
  return h * 60 + min
}
