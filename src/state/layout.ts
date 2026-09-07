/**
 * Turning a set of selected sessions into something drawable.
 *
 * Two problems the grid cannot ignore:
 *
 *  - The same lecture appears in several programmes' PDFs, and one programme may split
 *    it across the term. `Big Data / Data Visualization` occupies Monday 18:00–21:00 in
 *    three files, and MUII prints it twice more as `sep-oct` and `nov-ene` halves —
 *    four rows for one slot the student sits in once. They collapse into a single block
 *    carrying every programme tag, room and term label, because from the student's side
 *    it is one Monday evening.
 *  - Two *different* courses in the same slot is exactly the situation the student
 *    needs to see. Those get side-by-side lanes rather than being drawn on top of
 *    each other.
 */

import type { PlacedSession } from '../data/types.ts'

export type MergedSession = {
  /** Stable identity for React keys and collision lookup. */
  id: string
  course: PlacedSession['course']
  d: number
  s: number
  e: number
  progs: string[]
  rooms: string[]
  sems: string[]
  /** Term windows this slot is taught in; empty means the whole semester. */
  validityLabels: string[]
  inferred: boolean
  vision: boolean
  /** Lane index and lane count for side-by-side rendering. */
  lane: number
  lanes: number
}

/**
 * Rendering identity: course plus slot. Deliberately *excludes* the term window —
 * collision detection is validity-aware and runs on the unmerged sessions, so nothing
 * is lost by drawing the two halves of a split course as one block.
 */
const slotKey = (p: PlacedSession): string =>
  `${p.course.key}|${p.session.d}|${p.session.s}|${p.session.e}`

export function layoutWeek(placed: PlacedSession[]): MergedSession[] {
  // ── merge identical slots of the same course ──────────────────────────────
  const merged = new Map<string, MergedSession>()
  for (const p of placed) {
    const id = slotKey(p)
    const existing = merged.get(id)
    if (existing) {
      if (!existing.progs.includes(p.session.prog)) existing.progs.push(p.session.prog)
      if (p.session.room && !existing.rooms.includes(p.session.room)) existing.rooms.push(p.session.room)
      if (!existing.sems.includes(p.session.sem)) existing.sems.push(p.session.sem)
      if (p.session.v && !existing.validityLabels.includes(p.session.v.label)) {
        existing.validityLabels.push(p.session.v.label)
      }
      existing.inferred = existing.inferred || p.session.inferred === true
      existing.vision = existing.vision || p.session.vision === true
      continue
    }
    merged.set(id, {
      id,
      course: p.course,
      d: p.session.d,
      s: p.session.s,
      e: p.session.e,
      progs: [p.session.prog],
      rooms: p.session.room ? [p.session.room] : [],
      sems: [p.session.sem],
      validityLabels: p.session.v ? [p.session.v.label] : [],
      inferred: p.session.inferred === true,
      vision: p.session.vision === true,
      lane: 0,
      lanes: 1,
    })
  }

  // ── lanes, per weekday, per cluster of mutually overlapping blocks ─────────
  const all = [...merged.values()]
  for (let day = 1; day <= 5; day++) {
    const onDay = all.filter((m) => m.d === day).sort((a, b) => a.s - b.s || a.e - b.e)

    let cluster: MergedSession[] = []
    let clusterEnd = -Infinity

    const flush = (): void => {
      if (cluster.length === 0) return
      // Greedy lane assignment: reuse the first lane that has already finished.
      const laneEnds: number[] = []
      for (const block of cluster) {
        let lane = laneEnds.findIndex((end) => end <= block.s)
        if (lane === -1) {
          lane = laneEnds.length
          laneEnds.push(block.e)
        } else {
          laneEnds[lane] = block.e
        }
        block.lane = lane
      }
      for (const block of cluster) block.lanes = laneEnds.length
      cluster = []
      clusterEnd = -Infinity
    }

    for (const block of onDay) {
      if (block.s >= clusterEnd) flush()
      cluster.push(block)
      clusterEnd = Math.max(clusterEnd, block.e)
    }
    flush()
  }

  return all
}
