import { useDroppable } from './dnd.ts'
import { GRID_DROP } from './dnd.ts'
import { SessionBlock } from './SessionBlock.tsx'
import { fmtMin, progColour, WEEKDAYS } from './format.ts'
import { layoutWeek } from '../state/layout.ts'
import type { PlacedSession } from '../data/types.ts'
import type { SessionCollision } from '../state/collisions.ts'

/** The grid runs 09:00–21:00, the union of every programme's teaching window. */
const DAY_START = 9 * 60
const DAY_END = 21 * 60
const STEP = 30
const ROWS = (DAY_END - DAY_START) / STEP

/** The hour no programme teaches. Fintech omits it from its header entirely, so
 *  drawing it as a muted band makes the gap read as intentional. */
const LUNCH_START = 14 * 60
const LUNCH_END = 15 * 60

const rowOf = (min: number): number => (min - DAY_START) / STEP + 1

export type WeekGridProps = {
  placed: PlacedSession[]
  collisions: SessionCollision[]
  preview: PlacedSession[]
  onRemove: (key: string) => void
}

export function WeekGrid({ placed, collisions, preview, onRemove }: WeekGridProps) {
  const { setNodeRef, isOver } = useDroppable({ id: GRID_DROP })

  const blocks = layoutWeek(placed)

  const clashKeys = new Set<string>()
  for (const c of collisions) {
    clashKeys.add(slotId(c.a))
    clashKeys.add(slotId(c.b))
  }

  const occupied = new Set(placed.map((p) => `${p.session.d}:${p.session.s}`))
  const dimOthers = preview.length > 0

  return (
    <section
      ref={setNodeRef}
      aria-label="Weekly timetable"
      className="panel flex min-h-0 flex-col overflow-hidden transition-colors"
      style={isOver ? { borderColor: 'var(--text-faint)' } : undefined}
    >
      <div
        className="grid shrink-0 border-b text-[11px] font-medium uppercase tracking-wide"
        style={{
          gridTemplateColumns: '3.25rem repeat(5, minmax(0, 1fr))',
          borderColor: 'var(--line)',
          color: 'var(--text-dim)',
        }}
      >
        <div />
        {WEEKDAYS.map((d) => (
          <div key={d.n} className="px-2 py-1.5 text-center">
            {d.label}
          </div>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div
          className="relative grid"
          style={{
            gridTemplateColumns: '3.25rem repeat(5, minmax(0, 1fr))',
            gridTemplateRows: `repeat(${ROWS}, minmax(1.05rem, 1fr))`,
          }}
        >
          {/* hour rules + labels */}
          {Array.from({ length: ROWS }, (_, i) => {
            const min = DAY_START + i * STEP
            const onHour = min % 60 === 0
            const lunch = min >= LUNCH_START && min < LUNCH_END
            return (
              <div key={`r${i}`} className="contents">
                <div
                  className="border-t pr-1.5 text-right text-[10.5px] tabular-nums"
                  style={{
                    gridRow: i + 1,
                    gridColumn: 1,
                    borderColor: onHour ? 'var(--line)' : 'transparent',
                    color: 'var(--text-faint)',
                  }}
                >
                  {onHour ? fmtMin(min) : ''}
                </div>
                {WEEKDAYS.map((d) => (
                  <div
                    key={`${i}-${d.n}`}
                    className="border-t border-l"
                    style={{
                      gridRow: i + 1,
                      gridColumn: d.n + 1,
                      borderTopColor: onHour ? 'var(--line)' : 'transparent',
                      borderLeftColor: 'var(--line)',
                      background: lunch ? 'var(--surface-sunken)' : undefined,
                    }}
                  />
                ))}
              </div>
            )
          })}

          {/* preview of where a dragged course would land */}
          {preview.map((p, i) => (
            <div
              key={`pv${i}`}
              className="pointer-events-none m-[2px] rounded-md border-2 border-dashed"
              style={{
                gridColumn: p.session.d + 1,
                gridRow: `${rowOf(p.session.s)} / ${rowOf(p.session.e)}`,
                borderColor: occupied.has(`${p.session.d}:${p.session.s}`)
                  ? 'var(--danger)'
                  : progColour(p.session.prog),
                background: `color-mix(in oklab, ${progColour(p.session.prog)} 14%, transparent)`,
              }}
            />
          ))}

          {/* placed sessions */}
          {blocks.map((block, i) => (
            <SessionBlock
              key={block.id}
              block={block}
              index={i}
              row={[rowOf(block.s), rowOf(block.e)]}
              clashing={clashKeys.has(block.id)}
              dimmed={dimOthers}
              onRemove={onRemove}
            />
          ))}
        </div>
      </div>
    </section>
  )
}

/** Must match `layoutWeek`'s merge key so a collision lights up the right block. */
const slotId = (p: PlacedSession): string =>
  `${p.course.key}|${p.session.d}|${p.session.s}|${p.session.e}`
