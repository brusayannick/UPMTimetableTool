-- Build-time database for the UPM timetable builder.
--
-- Every table is STRICT and foreign keys are enforced. Several constraints here are
-- not hygiene but assertions about the data: they exist so that a parser bug becomes
-- a failed INSERT rather than a plausible-looking wrong answer in the UI. Each one is
-- commented with what it catches.

PRAGMA foreign_keys = ON;

CREATE TABLE source_file (
  id INTEGER PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('timetable', 'exam')),
  layout_family TEXT NOT NULL CHECK (layout_family IN
    ('T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'IMG-T', 'E-a', 'E-b', 'E-c', 'E-e', 'IMG-E')),
  extraction_method TEXT NOT NULL CHECK (extraction_method IN ('pdfjs', 'vision')),
  sha256 TEXT NOT NULL,
  -- `crosscheck` sources never contribute primary rows; `out-of-scope` records a
  -- deliberate exclusion so that `validate` can assert every PDF on disk is
  -- accounted for and none was silently skipped.
  role TEXT NOT NULL DEFAULT 'primary' CHECK (role IN ('primary', 'crosscheck', 'out-of-scope'))
) STRICT;

CREATE TABLE programme (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  short_name TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  language TEXT NOT NULL CHECK (language IN ('es', 'en')),
  colour TEXT NOT NULL
) STRICT;

CREATE TABLE semester (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE CHECK (code IN ('1S', '3S')),
  label_es TEXT NOT NULL,
  label_en TEXT NOT NULL
) STRICT;

CREATE TABLE course (
  id INTEGER PRIMARY KEY,
  programme_id INTEGER NOT NULL REFERENCES programme(id),
  canonical_key TEXT NOT NULL,
  -- The timetable spelling is preferred over the exam spelling: exam PDFs carry more
  -- typos (`Statisical`, `Knowledege`, `Poject`).
  display_name TEXT NOT NULL,
  is_elective INTEGER NOT NULL DEFAULT 0 CHECK (is_elective IN (0, 1)),
  -- Load-bearing. `Cloud Computing and Big Data Ecosystems Design` appears in both
  -- the DSC 1S and DSC 3S timetables and must collapse to one course with several
  -- sessions. If `normalise` is not a true identity function this INSERT fails.
  UNIQUE (programme_id, canonical_key)
) STRICT;

CREATE INDEX course_by_key ON course (canonical_key);

CREATE TABLE course_alias (
  id INTEGER PRIMARY KEY,
  course_id INTEGER NOT NULL REFERENCES course(id) ON DELETE CASCADE,
  raw_name TEXT NOT NULL,
  normalised TEXT NOT NULL,
  source_file_id INTEGER NOT NULL REFERENCES source_file(id),
  origin TEXT NOT NULL CHECK (origin IN ('timetable', 'exam', 'curated')),
  match_method TEXT NOT NULL CHECK (match_method IN
    ('exact', 'normalised', 'prefix', 'fuzzy', 'alias', 'split')),
  match_score REAL,
  UNIQUE (source_file_id, raw_name, course_id)
) STRICT;

CREATE TABLE session (
  id INTEGER PRIMARY KEY,
  course_id INTEGER NOT NULL REFERENCES course(id) ON DELETE CASCADE,
  semester_id INTEGER NOT NULL REFERENCES semester(id),
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN 1 AND 5),
  start_min INTEGER NOT NULL CHECK (start_min BETWEEN 480 AND 1290),
  end_min INTEGER NOT NULL CHECK (end_min > start_min AND end_min <= 1290),
  room TEXT,
  -- Set when the source restricts a session to part of the term (`sep-oct`,
  -- `nov-ene`, `Weeks 1-7`). Two sessions in the same slot with disjoint windows are
  -- not a collision.
  valid_from TEXT,
  valid_to TEXT,
  validity_label TEXT,
  span_source TEXT NOT NULL CHECK (span_source IN ('rect', 'inferred', 'explicit', 'vision')),
  -- Cost gap to the runner-up span assignment, when the span was inferred.
  span_margin REAL,
  source_file_id INTEGER NOT NULL REFERENCES source_file(id),
  -- No 15-minute boundary exists anywhere in the corpus, so an inference bug
  -- producing 16:20 dies here instead of shifting a lecture.
  -- Duplicate protection is the `session_unique` expression index below.
  CHECK (start_min % 30 = 0 AND end_min % 30 = 0)
) STRICT;

-- Catches double insertion — a real risk for the side-by-side layouts, where every
-- weekday name is printed twice on the same baseline. `COALESCE` is needed because a
-- plain UNIQUE over a nullable column would let NULLs through unchecked, and because
-- two sessions may legitimately share a slot when they cover different parts of the
-- term: MUII 3S teaches `Data Visualization` there in Sep–Oct and `Big Data` in
-- Nov–Jan, both Monday 18:00–21:00 in room 5001.
CREATE UNIQUE INDEX session_unique ON session (
  course_id, semester_id, weekday, start_min, source_file_id, COALESCE(validity_label, '')
);

CREATE INDEX session_by_course ON session (course_id);

CREATE TABLE exam (
  id INTEGER PRIMARY KEY,
  course_id INTEGER NOT NULL REFERENCES course(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  start_min INTEGER NOT NULL CHECK (start_min % 30 = 0),
  end_min INTEGER NOT NULL CHECK (end_min > start_min AND end_min % 30 = 0),
  -- Anything ending in `default2h` means the source did not print a duration and the
  -- 2-hour assumption was applied. The UI renders those differently.
  duration_source TEXT NOT NULL CHECK (duration_source IN
    ('explicit_range', 'start_override_default2h', 'vision_default2h', 'slot_default2h', 'curated')),
  slot_label TEXT,
  room TEXT,
  source_file_id INTEGER NOT NULL REFERENCES source_file(id),
  -- Deliberately *not* UNIQUE(course_id): MUII prints `Acessible Design and
  -- Assistive Products` in two date cells, which really are two separate courses'
  -- exams. `validate` hard-fails on any *undeclared* course with two exams, which is
  -- the check that catches the naive reading.
  UNIQUE (course_id, date, start_min)
) STRICT;

CREATE INDEX exam_by_course ON exam (course_id);
CREATE INDEX exam_by_date ON exam (date, start_min);

-- One row per file that independently asserts an exam. This is where the strongest
-- correctness evidence lives: several exams are asserted by up to five files across
-- four different layout families, and they have to agree.
CREATE TABLE exam_witness (
  exam_id INTEGER NOT NULL REFERENCES exam(id) ON DELETE CASCADE,
  source_file_id INTEGER NOT NULL REFERENCES source_file(id),
  raw_name TEXT NOT NULL,
  date TEXT NOT NULL,
  start_min INTEGER NOT NULL,
  end_min INTEGER,
  duration_source TEXT NOT NULL,
  PRIMARY KEY (exam_id, source_file_id, raw_name)
) STRICT;

CREATE TABLE diagnostic (
  id INTEGER PRIMARY KEY,
  severity TEXT NOT NULL CHECK (severity IN ('error', 'warn', 'info')),
  code TEXT NOT NULL,
  source_file_id INTEGER REFERENCES source_file(id),
  subject TEXT,
  detail TEXT NOT NULL,
  suggestion TEXT
) STRICT;

CREATE TABLE expectation (
  source_file_id INTEGER NOT NULL REFERENCES source_file(id),
  metric TEXT NOT NULL,
  expected INTEGER NOT NULL,
  actual INTEGER NOT NULL,
  PRIMARY KEY (source_file_id, metric)
) STRICT;

-- Informational ES↔EN links between the same course taught in two programmes.
-- Deliberately NOT used for joining: no scoring function bridges `Desarrollo de
-- Aplicaciones Distribuidas en Tiempo Real` and `Real time Distributed Applications
-- Development`, and forcing it would drown the ambiguity checks in noise.
CREATE TABLE equivalent_course (
  a_course_id INTEGER NOT NULL REFERENCES course(id),
  b_course_id INTEGER NOT NULL REFERENCES course(id),
  reason TEXT NOT NULL,
  PRIMARY KEY (a_course_id, b_course_id)
) STRICT;
