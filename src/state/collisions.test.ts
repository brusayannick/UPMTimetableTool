import { describe, expect, it } from 'vitest'
import type { Course, PlacedExam, PlacedSession } from '../data/types.ts'
import { blocksPlan } from './collisions.ts'

const course = (
  key: string,
  sessions: Course['sessions'] = [],
  exams: Course['exams'] = [],
): Course => ({ key, name: key, progs: ['1885'], elective: false, sessions, exams })

const placed = (courses: Course[]): { sessions: PlacedSession[]; exams: PlacedExam[] } => ({
  sessions: courses.flatMap((course) =>
    course.sessions.filter((s) => s.sem === '1S').map((session) => ({ course, session })),
  ),
  exams: courses.flatMap((course) => course.exams.map((exam) => ({ course, exam }))),
})

describe('blocksPlan', () => {
  it('is false when nothing overlaps', () => {
    const a = course('a', [{ prog: '1885', sem: '1S', d: 1, s: 900, e: 1020, room: null }])
    const b = course('b', [{ prog: '1885', sem: '1S', d: 2, s: 900, e: 1020, room: null }])
    const p = placed([a])
    expect(blocksPlan(b, p.sessions, p.exams, ['1S', '3S'])).toBe(false)
  })

  it('detects a session clash on the same weekday', () => {
    const a = course('a', [{ prog: '1885', sem: '1S', d: 1, s: 900, e: 1020, room: null }])
    const b = course('b', [{ prog: '1885', sem: '1S', d: 1, s: 960, e: 1080, room: null }])
    const p = placed([a])
    expect(blocksPlan(b, p.sessions, p.exams, ['1S', '3S'])).toBe(true)
  })

  it('ignores sessions outside the active semesters', () => {
    const a = course('a', [{ prog: '1885', sem: '1S', d: 1, s: 900, e: 1020, room: null }])
    const b = course('b', [{ prog: '1885', sem: '3S', d: 1, s: 900, e: 1020, room: null }])
    const p = placed([a])
    expect(blocksPlan(b, p.sessions, p.exams, ['1S'])).toBe(false)
  })

  it('detects an exam clash on the same date', () => {
    const a = course('a', [], [
      { date: '2027-01-12', s: 600, e: 720, room: null, slot: null, witnesses: 1, progs: ['1885'] },
    ])
    const b = course('b', [], [
      { date: '2027-01-12', s: 660, e: 780, room: null, slot: null, witnesses: 1, progs: ['1885'] },
    ])
    const p = placed([a])
    expect(blocksPlan(b, p.sessions, p.exams, ['1S', '3S'])).toBe(true)
  })

  it('treats even a possible (assumed-tail) exam clash as blocking', () => {
    const a = course('a', [], [
      { date: '2027-01-12', s: 600, e: 720, room: null, slot: null, assumed: true, witnesses: 1, progs: ['1885'] },
    ])
    const b = course('b', [], [
      { date: '2027-01-12', s: 700, e: 820, room: null, slot: null, assumed: true, witnesses: 1, progs: ['1885'] },
    ])
    const p = placed([a])
    expect(blocksPlan(b, p.sessions, p.exams, ['1S', '3S'])).toBe(true)
  })

  it('is false against an empty plan', () => {
    const b = course('b', [{ prog: '1885', sem: '1S', d: 1, s: 900, e: 1020, room: null }])
    expect(blocksPlan(b, [], [], ['1S', '3S'])).toBe(false)
  })
})
