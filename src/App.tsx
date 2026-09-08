import { useMemo, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  GRID_DROP,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  TRASH_DROP,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type DragData,
} from './components/dnd.ts'
import { ExamPanel } from './components/ExamPanel.tsx'
import { CourseDetails } from './components/CourseDetails.tsx'
import { Sidebar } from './components/Sidebar.tsx'
import { WeekGrid } from './components/WeekGrid.tsx'
import { creditsOfDetails, fmtDate, setPalette } from './components/format.ts'
import { usePlan } from './state/usePlan.ts'
import type { Bundle, PlacedSession } from './data/types.ts'

export function App({ bundle }: { bundle: Bundle }) {
  setPalette(bundle.programmes)
  const plan = usePlan(bundle)
  const [dragging, setDragging] = useState<DragData | null>(null)
  const [overGrid, setOverGrid] = useState(false)
  const [mobileTab, setMobileTab] = useState<'courses' | 'week' | 'exams'>('week')
  // Course detail popup, opened from the catalogue or the week grid.
  const [detailsKey, setDetailsKey] = useState<string | null>(null)
  const detailsCourse = detailsKey ? (bundle.courses.find((c) => c.key === detailsKey) ?? null) : null

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor),
  )

  // While a course hovers the grid, show every slot it would occupy — the landing
  // spots and any conflict are visible before the drop commits.
  const preview = useMemo<PlacedSession[]>(() => {
    if (!dragging || dragging.type !== 'course' || !overGrid) return []
    if (plan.selectedKeys.has(dragging.key)) return []
    const course = bundle.courses.find((c) => c.key === dragging.key)
    if (!course) return []
    return course.sessions
      .filter((s) => plan.state.semesters.includes(s.sem))
      .map((session) => ({ course, session }))
  }, [dragging, overGrid, bundle.courses, plan.selectedKeys, plan.state.semesters])

  const onDragStart = (ev: DragStartEvent): void => {
    setDragging((ev.active.data.current as DragData | undefined) ?? null)
  }

  const onDragOver = (ev: DragOverEvent): void => {
    setOverGrid(ev.over?.id === GRID_DROP)
  }

  const onDragEnd = (ev: DragEndEvent): void => {
    const data = ev.active.data.current as DragData | undefined
    setDragging(null)
    setOverGrid(false)
    if (!data) return

    if (data.type === 'course' && ev.over?.id === GRID_DROP) {
      plan.addCourse(data.key)
      return
    }
    // Dropping a placed session on the sidebar, or anywhere outside a target, takes
    // it out of the plan.
    if (data.type === 'session' && (ev.over?.id === TRASH_DROP || ev.over === null)) {
      plan.removeCourse(data.key)
    }
  }

  const dragged = dragging
    ? (bundle.courses.find((c) => c.key === dragging.key) ??
      plan.selected.find((c) => c.key === dragging.key))
    : null

  // Catalogue ECTS over the selected courses. Custom lessons carry no credits
  // and never count as missing.
  const ects = useMemo(() => {
    let total = 0
    let missing = 0
    for (const c of plan.selected) {
      if (c.key.startsWith('custom:')) continue
      const v = creditsOfDetails(c.details)
      if (v === null) missing++
      else total += v
    }
    return { total, missing }
  }, [plan.selected])
  const certain = plan.examClashes.filter((c) => c.severity === 'certain').length
  const possible = plan.examClashes.length - certain
  const programmesInPlan = new Set(plan.selected.flatMap((c) => c.progs))

  const pane = (tab: typeof mobileTab): string =>
    mobileTab === tab ? 'flex' : 'hidden lg:flex'

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        setDragging(null)
        setOverGrid(false)
      }}
      accessibility={{
        announcements: {
          onDragStart: ({ active }) => `Picked up ${label(active.id)}. Move over the week to add it.`,
          onDragOver: ({ over }) =>
            over?.id === GRID_DROP
              ? 'Over the weekly timetable. Release to add all of its sessions.'
              : over?.id === TRASH_DROP
                ? 'Over the course list. Release to remove it from the plan.'
                : 'Not over a drop target.',
          onDragEnd: ({ over }) =>
            over?.id === GRID_DROP ? 'Added to the plan.' : over?.id === TRASH_DROP ? 'Removed from the plan.' : 'Cancelled.',
          onDragCancel: () => 'Cancelled.',
        },
      }}
    >
      <div className="flex h-full flex-col gap-2 p-2 lg:gap-3 lg:p-3">
        <header className="flex shrink-0 flex-wrap items-baseline gap-x-3 gap-y-1 px-1">
          <h1 className="text-[15px] font-semibold">UPM Timetable Builder</h1>
          <p className="text-[11.5px]" style={{ color: 'var(--text-dim)' }}>
            {bundle.academicYear} · exams {fmtDate(bundle.examWindow.from)} – {fmtDate(bundle.examWindow.to)}
          </p>

          <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] tabular-nums">
            <span style={{ color: 'var(--text-dim)' }}>
              {plan.selected.length} {plan.selected.length === 1 ? 'course' : 'courses'}
            </span>
            {plan.selected.length > 0 && (
              <span
                style={{ color: 'var(--text-dim)' }}
                title={
                  ects.missing > 0
                    ? `Sum of catalogue ECTS for the selected courses. Excludes ${ects.missing} ${ects.missing === 1 ? 'course' : 'courses'} without catalogue credit data.`
                    : 'Sum of catalogue ECTS for the selected courses.'
                }
              >
                Σ {ects.total} ECTS
              </span>
            )}
            <span style={{ color: certain > 0 ? 'var(--danger)' : 'var(--text-dim)' }}>
              {certain} exam {certain === 1 ? 'clash' : 'clashes'}
            </span>
            {possible > 0 && <span style={{ color: 'var(--caution)' }}>{possible} possible</span>}
            {plan.sessionClashes.length > 0 && (
              <span style={{ color: 'var(--danger)' }}>
                {plan.sessionClashes.length} timetable {plan.sessionClashes.length === 1 ? 'overlap' : 'overlaps'}
              </span>
            )}
            {plan.assumedExams > 0 && (
              <span
                style={{ color: 'var(--text-faint)' }}
                title={`${plan.assumedExams} of the selected exams have an end time assumed at ${bundle.assumptions.defaultExamMinutes / 60} hours.`}
              >
                {plan.assumedExams} assumed duration{plan.assumedExams === 1 ? '' : 's'}
              </span>
            )}
            {programmesInPlan.size > 1 && (
              <span style={{ color: 'var(--text-faint)' }}>spans {programmesInPlan.size} programmes</span>
            )}
          </div>
        </header>

        {plan.dropped.length > 0 && (
          <div
            className="shrink-0 rounded-md px-3 py-2 text-[11.5px]"
            style={{ background: 'var(--caution-bg)', color: 'var(--caution)' }}
            role="status"
          >
            Dropped {plan.dropped.length} saved course{plan.dropped.length === 1 ? '' : 's'} that no longer exist
            in the data: {plan.dropped.join(', ')}.{' '}
            <button type="button" className="underline" onClick={plan.dismissDropped}>
              dismiss
            </button>
          </div>
        )}

        {/* Mobile pane switcher; on wide screens all three are visible at once. */}
        <nav className="flex shrink-0 gap-1 lg:hidden" aria-label="View">
          {(['courses', 'week', 'exams'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              className="chip flex-1 justify-center"
              aria-pressed={mobileTab === tab}
              onClick={() => setMobileTab(tab)}
            >
              {tab === 'courses' ? 'Courses' : tab === 'week' ? 'Week' : `Exams${certain ? ` (${certain})` : ''}`}
            </button>
          ))}
        </nav>

        <main className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)] gap-2 lg:grid-cols-[22rem_minmax(0,1fr)_21rem] lg:gap-3">
          <div className={`${pane('courses')} min-h-0 flex-col`}>
            <Sidebar bundle={bundle} plan={plan} onDetails={setDetailsKey} />
          </div>
          <div className={`${pane('week')} min-h-0 flex-col`}>
            <WeekGrid
              placed={plan.placedSessions}
              collisions={plan.sessionClashes}
              preview={preview}
              onRemove={plan.removeCourse}
              onDetails={setDetailsKey}
            />
          </div>
          <div className={`${pane('exams')} min-h-0 flex-col`}>
            <ExamPanel bundle={bundle} exams={plan.placedExams} collisions={plan.examClashes} />
          </div>
        </main>
      </div>

      {detailsCourse && (
        <CourseDetails
          course={detailsCourse}
          semesters={plan.state.semesters}
          onClose={() => setDetailsKey(null)}
        />
      )}

      <DragOverlay dropAnimation={null}>
        {dragged && (
          <div
            className="panel px-2.5 py-1.5 text-[12px] shadow-lg"
            style={{ background: 'var(--surface-raised)' }}
          >
            <div className="font-medium">{dragged.name}</div>
            <div className="text-[10.5px]" style={{ color: 'var(--text-dim)' }}>
              {dragged.sessions.length} {dragged.sessions.length === 1 ? 'session' : 'sessions'}
              {dragged.exams[0] && ` · exam ${fmtDate(dragged.exams[0].date)}`}
            </div>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  )

  function label(id: string | number): string {
    const key = String(id).split(':')[1] ?? ''
    return (
      bundle.courses.find((c) => c.key === key)?.name ??
      plan.selected.find((c) => c.key === key)?.name ??
      'course'
    )
  }
}
