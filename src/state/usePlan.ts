import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Bundle, Course, PlacedExam, PlacedSession, Semester } from '../data/types.ts'
import { blocksPlan, collidingKeys, examCollisions, sessionCollisions } from './collisions.ts'
import { customKey, decodeCustom, encodeCustom, type CustomLesson } from './custom.ts'

const STORAGE_KEY = 'upm-timetable-plan'

export type PlanState = {
  version: 1
  /** Canonical course keys, not numeric ids: a data rebuild must not wipe the plan. */
  selected: string[]
  programmes: string[]
  semesters: Semester[]
  search: string
  /** Sidebar shows only courses that would not clash with the current plan. */
  nonBlockingOnly: boolean
  /** User-defined lessons. Always part of the plan; definitions live here. */
  custom: CustomLesson[]
}

const EMPTY: PlanState = {
  version: 1,
  selected: [],
  programmes: [],
  semesters: ['1S', '3S'],
  search: '',
  nonBlockingOnly: false,
  custom: [],
}

function readHash(): string[] | null {
  const m = /(?:^|[#&])p=([^&]*)/.exec(window.location.hash)
  if (!m) return null
  return decodeURIComponent(m[1]!).split(',').map((s) => s.trim()).filter(Boolean)
}

/**
 * Custom lessons from the `c=` hash value. Null when the link carries none, in
 * which case the locally stored lessons are kept; an empty value clears them,
 * so a shared link always describes the whole plan.
 */
function readCustomHash(): CustomLesson[] | null {
  const m = /(?:^|[#&])c=([^&]*)/.exec(window.location.hash)
  if (!m) return null
  return decodeCustom(m[1]!)
}

function readStorage(): PlanState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return EMPTY
    const parsed = JSON.parse(raw) as Partial<PlanState>
    if (parsed.version !== 1) return EMPTY
    return { ...EMPTY, ...parsed }
  } catch {
    return EMPTY
  }
}

export function usePlan(bundle: Bundle) {
  const [state, setState] = useState<PlanState>(() => {
    const base = readStorage()
    const fromHash = readHash()
    const fromCustomHash = readCustomHash()
    return {
      ...base,
      selected: fromHash ?? base.selected,
      custom: fromCustomHash ?? base.custom,
    }
  })

  // Custom lessons as synthetic courses: one session per semester (so the
  // semester filter applies to them like everything else), no exams.
  const customCourses = useMemo<Course[]>(
    () =>
      state.custom.map((l) => ({
        key: customKey(l.id),
        name: l.name,
        progs: [],
        elective: false,
        sessions: (['1S', '3S'] as Semester[]).map((sem) => ({
          prog: 'custom',
          sem,
          d: l.day,
          s: l.start,
          e: l.end,
          room: l.room,
        })),
        exams: [],
      })),
    [state.custom],
  )

  const known = useMemo(
    () => new Map([...bundle.courses, ...customCourses].map((c) => [c.key, c])),
    [bundle, customCourses],
  )

  // A plan may reference a course that no longer exists after a data rebuild. Drop
  // those, but say so rather than losing them quietly.
  const [dropped, setDropped] = useState<string[]>([])
  useEffect(() => {
    const missing = state.selected.filter((k) => !known.has(k))
    if (missing.length > 0) {
      setDropped(missing)
      setState((s) => ({ ...s, selected: s.selected.filter((k) => known.has(k)) }))
    }
  }, [known, state.selected])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    const hash =
      state.selected.length > 0 || state.custom.length > 0
        ? `#p=${state.selected.join(',')}&c=${encodeCustom(state.custom)}`
        : ''
    if (window.location.hash !== hash) {
      window.history.replaceState(null, '', `${window.location.pathname}${hash}`)
    }
  }, [state])

  // Catalogue selection plus every custom lesson, which is always in the plan.
  const selected = useMemo(
    () => [
      ...state.selected.map((k) => known.get(k)).filter((c): c is Course => c !== undefined),
      ...customCourses,
    ],
    [state.selected, known, customCourses],
  )

  const addCourse = useCallback((key: string) => {
    setState((s) => (s.selected.includes(key) ? s : { ...s, selected: [...s.selected, key] }))
  }, [])

  // Grid blocks, Backspace and drag-out all funnel through here — including
  // custom lessons, whose keys never appear in `selected`.
  const removeCourse = useCallback((key: string) => {
    setState((s) => ({
      ...s,
      selected: s.selected.filter((k) => k !== key),
      custom: s.custom.filter((l) => customKey(l.id) !== key),
    }))
  }, [])

  const addCustomLesson = useCallback((lesson: Omit<CustomLesson, 'id'>) => {
    const id =
      globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
    setState((s) => ({ ...s, custom: [...s.custom, { ...lesson, id }] }))
  }, [])

  const removeCustomLesson = useCallback((id: string) => {
    setState((s) => ({ ...s, custom: s.custom.filter((l) => l.id !== id) }))
  }, [])

  const toggleCourse = useCallback((key: string) => {
    setState((s) => ({
      ...s,
      selected: s.selected.includes(key)
        ? s.selected.filter((k) => k !== key)
        : [...s.selected, key],
    }))
  }, [])

  const clear = useCallback(() => setState((s) => ({ ...s, selected: [] })), [])

  const patch = useCallback((p: Partial<PlanState>) => setState((s) => ({ ...s, ...p })), [])

  // ── derived ───────────────────────────────────────────────────────────────

  const placedSessions = useMemo<PlacedSession[]>(() => {
    const out: PlacedSession[] = []
    for (const course of selected) {
      for (const session of course.sessions) {
        if (!state.semesters.includes(session.sem)) continue
        out.push({ course, session })
      }
    }
    return out
  }, [selected, state.semesters])

  const placedExams = useMemo<PlacedExam[]>(
    () => selected.flatMap((course) => course.exams.map((exam) => ({ course, exam }))),
    [selected],
  )

  const sessionClashes = useMemo(() => sessionCollisions(placedSessions), [placedSessions])
  const examClashes = useMemo(() => examCollisions(placedExams), [placedExams])
  const clashing = useMemo(
    () => collidingKeys(sessionClashes, examClashes),
    [sessionClashes, examClashes],
  )

  const selectedKeys = useMemo(() => new Set(state.selected), [state.selected])

  // Courses (not already in the plan) that would clash with it if added.
  // Only computed when the filter is on and there is something to clash with.
  const blockingKeys = useMemo(() => {
    if (!state.nonBlockingOnly || selected.length === 0) return new Set<string>()
    const out = new Set<string>()
    for (const c of bundle.courses) {
      if (selectedKeys.has(c.key)) continue
      if (blocksPlan(c, placedSessions, placedExams, state.semesters)) out.add(c.key)
    }
    return out
  }, [state.nonBlockingOnly, state.semesters, selected, selectedKeys, bundle.courses, placedSessions, placedExams])

  const visible = useMemo(() => {
    const q = state.search.trim().toLowerCase()
    return bundle.courses.filter((c) => {
      if (state.programmes.length > 0 && !c.progs.some((p) => state.programmes.includes(p))) return false
      if (!c.sessions.some((s) => state.semesters.includes(s.sem)) && c.sessions.length > 0) return false
      if (q && !c.name.toLowerCase().includes(q)) return false
      if (state.nonBlockingOnly && blockingKeys.has(c.key)) return false
      return true
    })
  }, [bundle.courses, state.programmes, state.semesters, state.search, state.nonBlockingOnly, blockingKeys])

  const assumedExams = useMemo(
    () => placedExams.filter((p) => p.exam.assumed).length,
    [placedExams],
  )

  return {
    state,
    patch,
    selected,
    selectedKeys,
    visible,
    blockingKeys,
    addCourse,
    removeCourse,
    toggleCourse,
    clear,
    customCourses,
    addCustomLesson,
    removeCustomLesson,
    placedSessions,
    placedExams,
    sessionClashes,
    examClashes,
    clashing,
    assumedExams,
    dropped,
    dismissDropped: () => setDropped([]),
  }
}

export type Plan = ReturnType<typeof usePlan>
