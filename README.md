# UPM Timetable Builder

Pick courses, see the week, and check whether their January exams collide.

That last part is the point. UPM publishes each master's programme's timetable and exam
calendar as separate PDFs in unrelated table layouts, so the one thing a student needs
before choosing electives — *do any of these exams fall on top of each other?* — is
exactly the thing the sources do not tell you. This app scrapes all of them into one
database and answers it.

```
npm install
npm run data      # PDFs → sqlite → public/bundle.json
npm run dev       # http://localhost:5173
```

Six programmes, 73 courses, 88 sessions, 45 exams, from 13 PDFs (2026-27).

---

## Deploy

**Vercel.** Import the repo; the committed `vercel.json` already sets the Vite
build (`npm run build`, output `dist`). The build regenerates `bundle.json`
from the committed PDFs, so no environment variables are needed.

**Supabase.** The app serves the static `public/bundle.json`; Supabase is a
read-only mirror of that snapshot for querying elsewhere:

1. Create a project at supabase.com.
2. Apply `supabase/migrations/0001_schema.sql` — paste it into the SQL editor,
   or `supabase link` + `supabase db push`.
3. Copy `.env.example` to `.env` and fill in `SUPABASE_URL` plus the
   **service-role** key (never the anon key — seeding wipes and rewrites).
4. `npm run data && npm run supabase:seed`

Re-seed whenever the PDFs change; the seed always replaces the full snapshot.

---

## The data pipeline

Five stages, each writing an artefact the next one reads. The intermediate stages are
committed so that a parser change shows up as a reviewable **data** diff rather than as
an opaque behaviour change.

| stage | command | writes |
|---|---|---|
| extract | `npm run extract` | `data/extracted/<slug>.json` — positioned text runs and filled rectangles per PDF |
| parse | `npm run parse` | `data/parsed/<slug>.json` — sessions and exams with times and rooms |
| build | `npm run build:db` | `data/upm.sqlite`, `data/reports/join-report.md` |
| validate | `npm run validate` | `data/reports/crosscheck-report.md` |
| export | `npm run build:bundle` | `public/bundle.json` (~13 kB) |

`npm run data` runs all five. `npm run data:fast` skips extraction when only a parser
changed. `npm run extract -- --check` re-extracts in memory and fails if the committed
files are stale.

Useful when a PDF changes:

```
node scripts/inspect.ts hcid-schedule --rects    # see a file's geometry
```

### Why extraction is its own stage

Parser iteration is most of the work, and re-reading PDFs on every run is dead time.
Splitting it also means the extraction JSONs double as the fixtures for the geometry
unit tests, so `npm test` never touches a PDF, and sha256 pinning catches a swapped-in
`_v3` file.

### The awkward parts of the sources

Nothing here is a normal table. Every one of these is real:

- **Eight different layouts.** Two grids stacked with a `Mornings`/`Evenings` banner;
  two side by side with *two* weekday-label columns; one wide grid with the lunch
  hour omitted from its header; three exam layouts; a web-print list where each
  entry prints its own time range (T5); and a web-print day-columns × time-rows
  grid with the slot label repeated in every column (T6).
- **Two multi-page web prints.** The timetable lives on page 1; the rest is website
  navigation (plus February seminars in one file). Sources declare `pages: [0]`,
  and anything undeclared must still be single-page — a new multi-page file fails
  the extract rather than being silently read first-page-only.
- **Scaled graphics.** The web prints draw fills under scale/translate CTMs, so the
  extractor composes axis-aligned CTMs onto path bounds and refuses rotation.
- **macOS filenames.** `readdir` returns NFD (`Máster`) while the curation JSON is
  NFC; lookups and slugs normalise, or the same file counts as missing twice.
- **Column widths drift** by 15 % across a page, so boundaries come from the printed
  header-label centres, not from `width / n`.
- **Rectangles are not always cells.** In one timetable a single rectangle covers a
  whole row containing three courses. Where rectangles are unusable, spans are
  inferred from where the text sits.
- **A corrupt header.** The DSC 1S morning row prints `11:00-12:00` twice. The parser
  throws on a duplicate header label rather than mis-mapping the morning; the fix is a
  declared `headerOverride` that replaces the labels but keeps the printed positions.
- **A room printed once for a whole grid.** The MUIA title declares `Room 6201`
  for the timetable rather than per cell; sources carry it as `roomDefault`,
  used only when a cell prints no room itself.
- **Course names do not match** between a programme's timetable and its exam calendar:
  typos on one side or differently on both, `aging`/`Ageing`, `eHealth`/`E-Health`,
  a truncated `Environments: …`, `Aplications`, `Statisical`, dropped prefixes and
  suffixes, `&` vs `and`, a missing comma.

### Joining courses to exams

Resolution runs in a fixed order and **refuses rather than guesses** — a student sent to
the wrong exam is worse than a build that stops:

1. a curated alias, matched on the raw string before normalisation
2. a curated split, for one printed cell holding several courses
3. exact equality → 4. equality after normalisation → 5. equality after stripping a
   printed `HCI Basics:` prefix
6. fuzzy scoring, within the same programme only

The scorer combines edit distance with a **containment** term and **fuzzy token
equality**. Both earn their place on measured data: a dropped `Design` suffix scores
0.84 only because of containment, and a single-character typo scores 0.72 without fuzzy
tokens but 0.93 with them, because the typo'd token otherwise falls out of the token
intersection entirely. Every real match in the corpus lands at ≥ 0.80 and every known
non-match at ≤ 0.771.

Anything below that is an error, and the build exits non-zero. `data/curation/aliases.json`
records each curated resolution with what was verified.

### Exam durations

Almost no exam PDF prints a duration. Precedence:

| condition | end time | recorded as |
|---|---|---|
| a printed range, `(10:00 to 12:00)`, `(10-12h.)`, `(15:00-16:30)` | as printed | `explicit_range` |
| a bare start override, `12:00 h.` | start + 2 h | `start_override_default2h` |
| a transcribed source printing one time | start + 2 h | `vision_default2h` |
| otherwise | slot **start** + 2 h | `slot_default2h` |

The last row never uses the slot's *end*: a three-hour slot row is a window several
exams are scheduled inside, not a three-hour exam.

76 of 80 exam end times are therefore an assumption, and the UI says so — a `~` before
the end time, and an exam clash that exists **only** because of an assumed tail is shown
as *possible* (amber) rather than *certain* (red). That is what `duration_source` is
carried through the whole pipeline for.

---

## Is the scrape actually correct?

`npm run validate` answers this in six sections; the full output is
`data/reports/crosscheck-report.md`.

**A · Source accounting.** All 13 PDFs are declared in `data/curation/sources.json`,
so nothing can be silently skipped.

**B · Frozen per-file counts.** Seeded once from a hand-verified run. A parser change
that drops or duplicates a row fails here.

**C · Programme balance.** Four of six programmes reconcile *exactly* — same number of
courses, courses with a session, and courses with an exam:

| programme | courses | with a session | with an exam | |
|---|---|---|---|---|
| 10BA MUCD | 7 | 7 | 0 | − 7 declared exam-less (no exam calendar) |
| 1885 DSC | 14 | 14 | 13 | − 1 declared exam-less |
| 2235 HCID | 14 | 14 | 14 | exact |
| 2481 HMDA | 13 | 13 | 13 | + 1 declared orphan exam |
| 2603 Fintech | 5 | 5 | 5 | exact |
| MUIA AI | 20 | 20 | 0 | − 20 declared exam-less (no exam dates) |

**D · Column inference vs ground truth.** No cross-check screenshot exists in this
corpus, so this section is empty — the 34 inferred spans (HMDA row-union fills,
MUIA grid cells) stand on the frozen counts and the shared-exam agreement below.

**E · The month-calendar view.** No calendar file in this corpus; section empty.

**F · Shared exams across programmes — 11/11.** Eleven courses are taught in more than
one programme and so appear in several exam calendars, each printed in a different
layout and read by a different code path. All eleven agree on date and start time,
e.g. Cloud Computing and Big Data Ecosystems Design (DSC · HMDA, 14 Jan 15:00) and
E-Health: Promoting Active and Healthy Ageing (HCID · HMDA, 13 Jan 10:00 — a curated
override; both PDFs print 12:00, see `examOverrides` in `data/curation/fixups.json`).

No warnings remain.

`npm run validate -- --strict` promotes warnings to errors, so new ones cannot quietly
accumulate.

---

## The app

- **Drag a course from the list into the week** and it snaps into its real slots — all
  of them at once. There is deliberately no per-cell drop target, so "snap to the
  printed time" is structural rather than validated after the fact. While you drag,
  every landing spot is previewed and any occupied one is outlined in red.
- **Drag a block out**, or press Backspace on it, to remove the course. Every card also
  has a `+` button, so dragging is never the only path, and the keyboard sensor gives a
  Space/arrows/Space route with live-region narration.
- **Two courses in one slot** get side-by-side lanes. The same course listed by three
  programmes, or split into `sep-oct` and `nov-ene` halves, is one block carrying every
  programme tag — the student sits in it once.
- **Sessions limited to part of the term are hatched** and labelled, and collisions are
  always computed validity-aware (e.g. Fintech's Weeks 1–7 half of a Monday slot never
  clashes with what follows it).
- **Cross-programme picking is allowed** and on by default. The exam calendars say so
  themselves (`*compartidas con otros másteres`) and check F confirms it. The programme
  chips filter the sidebar; they never gate the plan.
- The plan lives in `localStorage` keyed by course name, not by database id, so
  rebuilding the data does not wipe it, and it is mirrored into the URL hash
  (`#p=key1,key2`) so a candidate combination can be shared.

Light and dark themes, no horizontal overflow at 390 px, `prefers-reduced-motion`
honoured. Red and amber appear only on collisions and assumptions, so they read as
signal.

---

## Layout

```
timetables/                input PDFs, never written to
data/
  extracted/                 stage 1, committed
  curation/                  sources · aliases · fixups · expectations · programmes
  parsed/                    stage 2, committed
  reports/                   join-report.md · crosscheck-report.md
  upm.sqlite                 derived
public/bundle.json           derived
scripts/
  lib/     pdf · geometry · normalize · fuzzy · time · examtime · db · schema.sql
  parsers/ timetable · exams · weblist
src/
  state/      usePlan · collisions · layout
  components/ WeekGrid · SessionBlock · Sidebar · CourseCard · ExamPanel · dnd
```

`scripts/lib/geometry.ts` holds the primitives the parsers share; the two that do
the real work, `partitionBandIntoSpans` and `colGridFromHeaderLines`, are covered by
golden tests against real fixture numbers (`npm test`, 37 tests).

`scripts/lib/pdf.ts` is the only place `pdfjs-dist` is imported, and it asserts the
API facts it relies on rather than assuming them.

`scripts/lib/schema.sql` uses constraints as assertions — a span-inference bug producing
16:20 fails an INSERT instead of shifting a lecture. Each one is commented with what it
catches.

## Adding or replacing a PDF

1. Drop it in `timetables/`.
2. Declare it in `data/curation/sources.json` — `validate` fails otherwise.
3. `npm run data`. Read what it says: an unresolved course name, a count that moved or a
   cross-check that broke is the pipeline telling you something real.
4. If it is multi-page, declare which pages hold the timetable in `pages` (the rest
   must be junk); if it draws under scaled CTMs, extraction already composes them,
   and rotation still fails loudly.

## Scope

Six programmes from the PDFs in `timetables/`: EIT Digital Data Science (1885),
HCID (2235), HMDA (2481) and Fintech (2603) with 2026-27 weekly schedules plus
January 2027 exam calendars, and two timetable-only web prints — the Data
Science master MUCD (10BA, 1st-semester electives, 2026-27) and the Artificial
Intelligence master MUIA (2026-27 A-subject grid, one room for the whole grid).
Neither web print ships an exam calendar, so both
programmes' courses are declared exam-less and take no part in collision
checking. Nothing from the old `exams/` corpus or the image-only
transcriptions is used.
