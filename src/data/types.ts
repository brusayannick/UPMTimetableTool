/** Shape of `public/bundle.json`, written by `scripts/export-bundle.ts`. */

export type Semester = '1S' | '3S'
export type Weekday = 1 | 2 | 3 | 4 | 5

export type Validity = { label: string; from: string; to: string }

export type Session = {
  prog: string
  sem: Semester
  /** Weekday, Monday = 1. */
  d: Weekday
  /** Start, minutes since midnight. */
  s: number
  /** End, minutes since midnight. */
  e: number
  room: string | null
  /** Set when the session only runs during part of the term. */
  v?: Validity
  /** The span was derived from text position, not from a printed cell rectangle. */
  inferred?: true
  /** Transcribed from an image-only PDF. */
  vision?: true
}

export type Exam = {
  /** ISO `YYYY-MM-DD`. */
  date: string
  s: number
  e: number
  room: string | null
  /** The printed time window the exam sits in, when the source states one. */
  slot: string | null
  /** The end time is the 2-hour default, not something the source printed. */
  assumed?: true
  vision?: true
  /** How many source files independently assert this exam. */
  witnesses: number
  progs: string[]
}

export type Course = {
  key: string
  name: string
  progs: string[]
  elective: boolean
  sessions: Session[]
  exams: Exam[]
  /** Incoming-student catalogue rows for this course, if the CSV knows it. */
  details?: CourseDetails[]
}

/**
 * One row of the ETSIINF incoming-student catalogue
 * (`timetables/Application_ETSIINF_Courses_Incoming_Student_unprotected.csv`).
 * Every field is the printed cell verbatim, except that empty cells and
 * `#REF!` errors arrive as `''`.
 */
export type CourseDetails = {
  plans: string
  codes: string
  name: string
  englishName: string
  year: string
  credits: string
  language: string
  semester: string
  group: string
  level: string
  quota: string
  learningGuide: string
  observations: string
}

export type Programme = {
  code: string
  short: string
  name: string
  lang: 'es' | 'en'
  colour: string
}

export type Bundle = {
  schemaVersion: 1
  builtAt: string
  academicYear: string
  assumptions: { defaultExamMinutes: number }
  examWindow: { from: string; to: string }
  programmes: Programme[]
  courses: Course[]
  notes: { code: string; text: string }[]
}

/** A session paired with the course it belongs to — what the grid actually renders. */
export type PlacedSession = { course: Course; session: Session }

/** An exam paired with its course. */
export type PlacedExam = { course: Course; exam: Exam }
