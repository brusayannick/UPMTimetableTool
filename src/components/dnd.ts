/**
 * The only place `@dnd-kit` is imported.
 *
 * Keeping it behind one module means the drag layer can be swapped for native HTML5
 * drag-and-drop without touching a component — this interaction is simple enough that
 * either would do, and the adapter is cheap insurance against a peer-range fight.
 */

export {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core'

export type { DragEndEvent, DragOverEvent, DragStartEvent } from '@dnd-kit/core'

/** Droppable ids. There is deliberately no per-cell target: a course can only be
 *  dropped "into the week", never "at a time", so the snapping semantics are
 *  structural rather than validated after the fact. */
export const GRID_DROP = 'grid'
export const TRASH_DROP = 'trash'

export const courseDragId = (key: string): string => `course:${key}`
export const sessionDragId = (key: string, index: number): string => `session:${key}:${index}`

export type DragData = { type: 'course' | 'session'; key: string }
