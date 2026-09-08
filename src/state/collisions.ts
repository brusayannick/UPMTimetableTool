/**
 * Collision detection. Pure functions, no React — the grid, the exam panel and the
 * status line all read from the same result.
 *
 * Two rules that matter more than the overlap test itself:
 *
 *  - A timetable collision requires the two sessions' *term windows* to overlap.
 *    MUII 3S teaches `Data Visualization` on Monday 18:00–21:00 in September and
 *    October and `Big Data` in the same slot from November, which is not a clash.
 *  - An exam collision is only *certain* when it survives shrinking every assumed
 *    end time. 76 of 80 exam end times are the 2-hour default rather than a printed
 *    value, so a collision that depends on one of those tails is an inference and is
 *    labelled as such.
 */

import type { Course, PlacedExam, PlacedSession, Semester, Validity } from '../data/types.ts'

export type Severity = 'certain' | 'possible'

export type SessionCollision = {
  kind: 'session'
  a: PlacedSession
  b: PlacedSession
  day: number
}

export type ExamCollision = {
  kind: 'exam'
  a: PlacedExam
  b: PlacedExam
  date: string
  severity: Severity
  /** Set on a `possible` collision: what makes it uncertain. */
  because?: string
}

export const rangesOverlap = (a: Validity | undefined, b: Validity | undefined): boolean => {
  if (!a || !b) return true
  return a.from <= b.to && b.from <= a.to
}

/** Overlapping weekly slots, per weekday, validity-aware. */
export function sessionCollisions(placed: PlacedSession[]): SessionCollision[] {
  const out: SessionCollision[] = []
  for (let day = 1; day <= 5; day++) {
    const onDay = placed
      .filter((p) => p.session.d === day)
      .sort((x, y) => x.session.s - y.session.s)
    for (let i = 0; i < onDay.length; i++) {
      for (let j = i + 1; j < onDay.length; j++) {
        const a = onDay[i]!
        const b = onDay[j]!
        if (b.session.s >= a.session.e) break
        if (a.course.key === b.course.key) continue
        if (!rangesOverlap(a.session.v, b.session.v)) continue
        out.push({ kind: 'session', a, b, day })
      }
    }
  }
  return out
}

/**
 * Overlapping exams, per date.
 *
 * Severity comes from re-running the overlap test with every assumed end time
 * shrunk to `start + 1`: if the overlap survives that, the printed start times alone
 * put the two exams on top of each other and it is a fact. If it disappears, the
 * clash exists only because both exams were *assumed* to run for two hours.
 */
export function examCollisions(placed: PlacedExam[]): ExamCollision[] {
  const out: ExamCollision[] = []
  const byDate = new Map<string, PlacedExam[]>()
  for (const p of placed) {
    const list = byDate.get(p.exam.date)
    if (list) list.push(p)
    else byDate.set(p.exam.date, [p])
  }

  for (const [date, list] of byDate) {
    const sorted = [...list].sort((x, y) => x.exam.s - y.exam.s)
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const a = sorted[i]!
        const b = sorted[j]!
        if (b.exam.s >= a.exam.e) break
        if (a.course.key === b.course.key) continue

        const hardEnd = (p: PlacedExam): number => (p.exam.assumed ? p.exam.s + 1 : p.exam.e)
        const certain = b.exam.s < hardEnd(a) && a.exam.s < hardEnd(b)

        out.push({
          kind: 'exam',
          a,
          b,
          date,
          severity: certain ? 'certain' : 'possible',
          ...(certain
            ? {}
            : {
                because:
                  'the overlap depends on an end time the source does not print — both exams ' +
                  'are assumed to last 2 hours',
              }),
        })
      }
    }
  }
  return out
}

/** Course keys involved in at least one collision, for badging cards and blocks. */
export function collidingKeys(
  sessions: SessionCollision[],
  exams: ExamCollision[],
): Set<string> {
  const keys = new Set<string>()
  for (const c of sessions) {
    keys.add(c.a.course.key)
    keys.add(c.b.course.key)
  }
  for (const c of exams) {
    keys.add(c.a.course.key)
    keys.add(c.b.course.key)
  }
  return keys
}

/**
 * Would adding `candidate` to the plan create a session or exam clash with
 * what is already placed? Same overlap rules as the plan itself (validity
 * windows for sessions; assumed 2-hour tails count, so even a `possible`
 * exam clash blocks). The candidate's own sessions are limited to the active
 * semesters, mirroring the grid.
 */
export function blocksPlan(
  candidate: Course,
  placedSessions: PlacedSession[],
  placedExams: PlacedExam[],
  semesters: Semester[],
): boolean {
  const candSessions: PlacedSession[] = candidate.sessions
    .filter((s) => semesters.includes(s.sem))
    .map((session) => ({ course: candidate, session }))
  if (candSessions.length > 0 && placedSessions.length > 0) {
    const clashes = sessionCollisions([...placedSessions, ...candSessions])
    if (clashes.some((c) => c.a.course.key === candidate.key || c.b.course.key === candidate.key)) {
      return true
    }
  }
  if (candidate.exams.length > 0 && placedExams.length > 0) {
    const candExams: PlacedExam[] = candidate.exams.map((exam) => ({ course: candidate, exam }))
    const clashes = examCollisions([...placedExams, ...candExams])
    if (clashes.some((c) => c.a.course.key === candidate.key || c.b.course.key === candidate.key)) {
      return true
    }
  }
  return false
}
