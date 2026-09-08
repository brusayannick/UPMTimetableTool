import { TRASH_DROP, useDroppable } from './dnd.ts'
import { CourseCard } from './CourseCard.tsx'
import { CustomLessons } from './CustomLessons.tsx'
import { progColour } from './format.ts'
import type { Bundle } from '../data/types.ts'
import type { Plan } from '../state/usePlan.ts'

export function Sidebar({ bundle, plan }: { bundle: Bundle; plan: Plan }) {
  // Dropping a session here removes it. The sidebar is the natural "put it back"
  // target, and dropping outside any target removes it too, so the gesture is
  // forgiving either way.
  const { setNodeRef, isOver } = useDroppable({ id: TRASH_DROP })
  const { state, patch, visible, selectedKeys, clashing, toggleCourse } = plan

  const toggleProgramme = (code: string): void => {
    patch({
      programmes: state.programmes.includes(code)
        ? state.programmes.filter((p) => p !== code)
        : [...state.programmes, code],
    })
  }

  return (
    <aside
      ref={setNodeRef}
      aria-label="Course catalogue"
      className="panel flex min-h-0 flex-col overflow-hidden transition-colors"
      style={isOver ? { borderColor: 'var(--danger)' } : undefined}
    >
      <CustomLessons
        lessons={state.custom}
        onAdd={plan.addCustomLesson}
        onRemove={plan.removeCustomLesson}
      />

      <div className="shrink-0 border-b px-3 pt-3 pb-2.5" style={{ borderColor: 'var(--line)' }}>
        <div className="flex flex-wrap gap-1">
          {bundle.programmes.map((p) => (
            <button
              key={p.code}
              type="button"
              className="chip"
              aria-pressed={state.programmes.includes(p.code)}
              onClick={() => toggleProgramme(p.code)}
              title={p.name}
              style={{ color: state.programmes.includes(p.code) ? p.colour : undefined }}
            >
              <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ background: p.colour }} />
              {p.short}
            </button>
          ))}
          {state.programmes.length > 0 && (
            <button type="button" className="chip" onClick={() => patch({ programmes: [] })}>
              all
            </button>
          )}
        </div>

        <div className="mt-2 flex items-center gap-1">
          {(['1S', '3S'] as const).map((sem) => (
            <button
              key={sem}
              type="button"
              className="chip"
              aria-pressed={state.semesters.includes(sem)}
              onClick={() =>
                patch({
                  semesters: state.semesters.includes(sem)
                    ? state.semesters.filter((s) => s !== sem)
                    : [...state.semesters, sem],
                })
              }
            >
              {sem}
            </button>
          ))}
          <button
            type="button"
            className="chip"
            aria-pressed={state.nonBlockingOnly}
            title="Only show courses that would not clash with the current plan"
            onClick={() => patch({ nonBlockingOnly: !state.nonBlockingOnly })}
          >
            fits plan
          </button>
          <input
            type="search"
            value={state.search}
            onChange={(ev) => patch({ search: ev.target.value })}
            placeholder="Search courses…"
            aria-label="Search courses"
            className="ml-auto w-full min-w-0 rounded-md border px-2 py-1 text-[12px] outline-none"
            style={{ borderColor: 'var(--line-strong)', background: 'var(--surface)', color: 'var(--text)' }}
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {visible.length === 0 ? (
          <p className="px-1 py-6 text-center text-[12px]" style={{ color: 'var(--text-faint)' }}>
            No course matches these filters.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {visible.map((course) => (
              <CourseCard
                key={course.key}
                course={course}
                inPlan={selectedKeys.has(course.key)}
                clashing={selectedKeys.has(course.key) && clashing.has(course.key)}
                semesters={state.semesters}
                onToggle={toggleCourse}
              />
            ))}
          </ul>
        )}
      </div>

      <div
        className="shrink-0 border-t px-3 py-2 text-[11px]"
        style={{ borderColor: 'var(--line)', color: 'var(--text-faint)' }}
      >
        {visible.length} of {bundle.courses.length} courses
        {plan.selected.length > 0 && (
          <>
            {' · '}
            <button type="button" className="underline" onClick={plan.clear}>
              clear plan
            </button>
          </>
        )}
        <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5">
          {bundle.programmes.map((p) => (
            <span key={p.code} className="inline-flex items-center gap-1">
              <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ background: progColour(p.code) }} />
              {p.code}
            </span>
          ))}
        </div>
      </div>
    </aside>
  )
}
