/**
 * Deriving an exam's start and end.
 *
 * Almost none of the exam PDFs print a duration. The precedence below is the whole
 * of the rule, and every branch records *why* the end time is what it is, so the UI
 * can show an inferred end as an assumption rather than a fact.
 *
 * The rules were checked end to end against a course three files disagree about how
 * to print: `E-Health` gets 14 January 12:00–14:00 from HCID's 12:00–15:00 slot row
 * (rule 4), from HMDA's bare `12:00 h.` override (rule 2) and from the MUIS exam
 * list's plain `12:00` (rule 3). Three rules, three files, one answer.
 */

import type { Annotation } from './geometry.ts'
import type { DurationSource } from './types.ts'

/** The user-specified default for exams whose length the source does not state. */
export const DEFAULT_EXAM_MINUTES = 120

export type ExamTiming = {
  startMin: number
  endMin: number
  durationSource: DurationSource
  /** True when a printed range falls outside its slot row — a source inconsistency. */
  outsideSlot: boolean
}

export function deriveExamTime(
  annotations: Annotation[],
  slot: { startMin: number; endMin: number },
  source: 'pdfjs' | 'vision',
  visionTime?: { startMin: number; endMin?: number },
): ExamTiming {
  // 1. an explicitly printed range wins outright
  const explicit = annotations.find((a) => a.kind === 'explicitRange')
  if (explicit?.kind === 'explicitRange') {
    return {
      startMin: explicit.startMin,
      endMin: explicit.endMin,
      durationSource: 'explicit_range',
      outsideSlot: explicit.startMin < slot.startMin || explicit.endMin > slot.endMin,
    }
  }

  // 2. a bare start-time override beside the course name
  const override = annotations.find((a) => a.kind === 'startOverride')
  if (override?.kind === 'startOverride') {
    return {
      startMin: override.startMin,
      endMin: override.startMin + DEFAULT_EXAM_MINUTES,
      durationSource: 'start_override_default2h',
      outsideSlot: false,
    }
  }

  // 3. a transcribed source that prints a time per exam
  if (source === 'vision' && visionTime) {
    if (visionTime.endMin !== undefined) {
      return {
        startMin: visionTime.startMin,
        endMin: visionTime.endMin,
        durationSource: 'explicit_range',
        outsideSlot: false,
      }
    }
    return {
      startMin: visionTime.startMin,
      endMin: visionTime.startMin + DEFAULT_EXAM_MINUTES,
      durationSource: 'vision_default2h',
      outsideSlot: false,
    }
  }

  // 4. the slot row's *start*, never its end: a three-hour slot is not a
  //    three-hour exam, it is a window several exams are scheduled inside.
  return {
    startMin: slot.startMin,
    endMin: slot.startMin + DEFAULT_EXAM_MINUTES,
    durationSource: 'slot_default2h',
    outsideSlot: false,
  }
}

/** Strongest wins when several files assert the same exam. */
export const DURATION_STRENGTH: Record<DurationSource, number> = {
  curated: 5,
  explicit_range: 4,
  start_override_default2h: 3,
  vision_default2h: 2,
  slot_default2h: 1,
}

export const isAssumed = (s: DurationSource): boolean => s.endsWith('default2h')
