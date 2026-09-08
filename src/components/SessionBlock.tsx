import { sessionDragId, useDraggable } from './dnd.ts'
import { fmtRange, progColour } from './format.ts'
import type { MergedSession } from '../state/layout.ts'

export type SessionBlockProps = {
  block: MergedSession
  index: number
  row: [number, number]
  clashing: boolean
  dimmed: boolean
  onRemove: (key: string) => void
  onDetails: (key: string) => void
}

export function SessionBlock({ block, index, row, clashing, dimmed, onRemove, onDetails }: SessionBlockProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: sessionDragId(block.course.key, index),
    data: { type: 'session', key: block.course.key },
  })

  const accent = progColour(block.progs[0] ?? '')
  const rows = row[1] - row[0]
  const width = 100 / block.lanes
  const narrow = block.lanes > 1
  const hasDetails = !!block.course.details && block.course.details.length > 0

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      role="button"
      tabIndex={0}
      onDoubleClick={(ev) => {
        if ((ev.target as HTMLElement).closest('button')) return
        if (hasDetails) onDetails(block.course.key)
      }}
      title={[
        block.course.name,
        fmtRange(block.s, block.e),
        block.rooms.length > 0 ? `Room ${block.rooms.join(' / ')}` : null,
        `${block.progs.join(', ')} · ${block.sems.join(', ')}`,
        block.validityLabels.length > 0 ? `only during ${block.validityLabels.join(', ')}` : null,
        block.inferred ? 'Span inferred from text position, not from a printed cell.' : null,
        block.vision ? 'Transcribed from an image-only PDF.' : null,
        clashing ? '⚠ Overlaps another selected course.' : null,
        'Backspace or drag out to remove.',
      ].filter(Boolean).join('\n')}
      onKeyDown={(ev) => {
        if (ev.key === 'Backspace' || ev.key === 'Delete') {
          ev.preventDefault()
          onRemove(block.course.key)
        }
      }}
      className={`group relative cursor-grab overflow-hidden rounded-md px-1.5 py-1 text-left ${
        block.validityLabels.length > 0 ? 'hatched' : ''
      }`}
      style={{
        gridColumn: block.d + 1,
        gridRow: `${row[0]} / ${row[1]}`,
        marginLeft: `calc(${block.lane * width}% + 2px)`,
        width: `calc(${width}% - 4px)`,
        marginTop: 2,
        marginBottom: 2,
        color: accent,
        // Programme identity is the tint and the text colour; a collision outlines the
        // whole block, because a clash is a property of the block rather than of one
        // of its edges.
        background: clashing ? 'var(--danger-bg)' : `color-mix(in oklab, ${accent} var(--tint), var(--surface))`,
        boxShadow: clashing
          ? 'inset 0 0 0 1.5px var(--danger)'
          : `inset 0 0 0 1px color-mix(in oklab, ${accent} 35%, transparent)`,
        opacity: isDragging ? 0.4 : dimmed ? 0.35 : 1,
        transition: 'opacity 120ms',
      }}
    >
      <div className="flex items-start gap-1">
        {clashing && (
          <span aria-hidden style={{ color: 'var(--danger)' }} className="shrink-0 text-[11px] leading-tight">
            ⚠
          </span>
        )}
        <span
          className="min-w-0 flex-1 text-[11.5px] font-medium leading-tight"
          style={{
            color: 'var(--text)',
            display: '-webkit-box',
            WebkitLineClamp: rows <= 2 ? 2 : narrow ? 3 : 4,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {block.course.name}
        </span>
      </div>

      {rows > 2 && (
        <div
          className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[10px] tabular-nums"
          style={{ color: 'var(--text-dim)' }}
        >
          <span>{fmtRange(block.s, block.e)}</span>
          {block.rooms.length > 0 && <span>· {block.rooms.join('/')}</span>}
          {block.validityLabels.length > 0 && (
            <span style={{ color: accent }}>· {block.validityLabels.join(', ')}</span>
          )}
          {block.progs.length > 1 && !narrow && <span>· {block.progs.join(' ')}</span>}
        </div>
      )}

      <button
        type="button"
        aria-label={`Remove ${block.course.name} from the plan`}
        onPointerDown={(ev) => ev.stopPropagation()}
        onClick={(ev) => {
          ev.stopPropagation()
          onRemove(block.course.key)
        }}
        className="absolute top-0.5 right-0.5 h-4 w-4 rounded opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
        style={{ background: 'var(--surface)', color: 'var(--text-dim)', fontSize: '11px', lineHeight: '15px' }}
      >
        ×
      </button>
    </div>
  )
}
