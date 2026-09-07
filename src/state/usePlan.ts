import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Bundle, Course, PlacedExam, PlacedSession, Semester } from '../data/types.ts'
import { collidingKeys, examCollisions, sessionCollisions } from './collisions.ts'

const STORAGE_KEY = 'upm-timetable-plan'

export type PlanState = {
  version: 1
  /** Canonical course keys, not numeric ids: a data rebuild must not wipe the plan. */
  selected: string[]
  programmes: string[]
  semesters: Semester[]
  search: string
}

const EMPTY: PlanState = {
  version: 1,
  selected: [],
  programmes: [],
  semesters: ['1S', '3S'],
  search: '',
}

function readHash(): string[] | null {
  const m = /(?:^|[#&])p=([^&]*)/.exec(window.location.hash)
  if (!m) return null
  return decodeURIComponent(m[1]!).split(',').map((s) => s.trim()).filter(Boolean)
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
  const known = useMemo(() => new Map(bundle.courses.map((c) => [c.key, c])), [bundle])

  const [state, setState] = useState<PlanState>(() => {
    const base = readStorage()
    const fromHash = readHash()
    return fromHash ? { ...base, selected: fromHash } : base
  })

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
    const hash = state.selected.length > 0 ? `#p=${state.selected.join(',')}` : ''
    if (window.location.hash !== hash) {
      window.history.replaceState(null, '', `${window.location.pathname}${hash}`)
    }
  }, [state])

  const selected = useMemo(
    () => state.selected.map((k) => known.get(k)).filter((c): c is Course => c !== undefined),
    [state.selected, known],
  )

  const addCourse = useCallback((key: string) => {
    setState((s) => (s.selected.includes(key) ? s : { ...s, selected: [...s.selected, key] }))
  }, [])

  const removeCourse = useCallback((key: string) => {
    setState((s) => ({ ...s, selected: s.selected.filter((k) => k !== key) }))
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

  const visible = useMemo(() => {
    const q = state.search.trim().toLowerCase()
    return bundle.courses.filter((c) => {
      if (state.programmes.length > 0 && !c.progs.some((p) => state.programmes.includes(p))) return false
      if (!c.sessions.some((s) => state.semesters.includes(s.sem)) && c.sessions.length > 0) return false
      if (q && !c.name.toLowerCase().includes(q)) return false
      return true
    })
  }, [bundle.courses, state.programmes, state.semesters, state.search])

  const assumedExams = useMemo(
    () => placedExams.filter((p) => p.exam.assumed).length,
    [placedExams],
  )

  return {
    state,
    patch,
    selected,
    selectedKeys: new Set(state.selected),
    visible,
    addCourse,
    removeCourse,
    toggleCourse,
    clear,
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
