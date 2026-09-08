# Verification report

## A · Source accounting

13 PDFs on disk · 13 primary · 0 cross-check · 0 deliberately excluded


## B · Per-file counts against frozen expectations

| file | metric | expected | actual |
|---|---|---|---|
| 1885_DSC MUID_schedule_2026-27_1S.pdf | courses | 7 | 7 |
| 1885_DSC MUID_schedule_2026-27_1S.pdf | filler | 0 | 0 |
| 1885_DSC MUID_schedule_2026-27_3S.pdf | courses | 9 | 9 |
| 1885_DSC MUID_schedule_2026-27_3S.pdf | filler | 0 | 0 |
| 2235_HCID MUID_schedule_2026-27_1S.pdf | courses | 9 | 9 |
| 2235_HCID MUID_schedule_2026-27_1S.pdf | filler | 0 | 0 |
| 2235_HCID_MUID_schedule_2026-27_3S.pdf | courses | 7 | 7 |
| 2235_HCID_MUID_schedule_2026-27_3S.pdf | filler | 0 | 0 |
| 2481_HMDA_MUID_schedule_2026-27_1S.pdf | courses | 9 | 9 |
| 2481_HMDA_MUID_schedule_2026-27_1S.pdf | filler | 1 | 1 |
| 2481_HMDA_MUID_schedule_2026-27_3S.pdf | courses | 5 | 5 |
| 2481_HMDA_MUID_schedule_2026-27_3S.pdf | filler | 0 | 0 |
| 2603_Fintech MUID_schedule_2026-27_1S.pdf | courses | 9 | 9 |
| 2603_Fintech MUID_schedule_2026-27_1S.pdf | filler | 0 | 0 |
| 1885_DSC MUID_exams_2026-27_january.pdf | exams | 13 | 13 |
| 2235_HCID MUID_exams_2026-27_january.pdf | exams | 14 | 14 |
| 2481_HMDA_MUID_exams_2026-27_january.pdf | exams | 14 | 14 |
| 2603_Fintech MUID_exams_2026-27_january.pdf | exams | 5 | 5 |
| Timetable 26_27 - Máster Universitario en Ciencia de Datos.pdf | courses | 8 | 8 |
| Timetable 26_27 - Máster Universitario en Ciencia de Datos.pdf | filler | 3 | 3 |
| Timetable - Master's Degree in Artificial Intelligence.pdf | courses | 25 | 25 |
| Timetable - Master's Degree in Artificial Intelligence.pdf | filler | 0 | 0 |

## C · Programme balance

| programme | courses | with a session | with an exam | reconciliation |
|---|---|---|---|---|
| 10BA | 7 | 7 | 0 | −7 declared exam-less |
| 1885 | 14 | 14 | 13 | −1 declared exam-less |
| 2235 | 14 | 14 | 14 | exact |
| 2481 | 13 | 13 | 13 | +1 declared orphan exam |
| 2603 | 5 | 5 | 5 | exact |
| MUIA | 20 | 20 | 0 | −20 declared exam-less |

## D · Column inference against the ground-truth screenshot

## E · Month-calendar view against the exam grid

This is also the proof that the per-font `ToUnicode` path works: without CMap
resolution the source file yields `!"#$"%&'()` instead of course names.

## F · Shared-exam agreement across programmes

Courses taught in more than one programme appear in several exam calendars, each
printed in a different layout and parsed by a different code path. Every one of
them has to give the same answer.

| course | asserted by | date | time | |
|---|---|---|---|---|
| Big Data / Data Visualization | 1885/E-b · 2481/E-c | 2027-01-11 | 15:00 | ✓ |
| Cloud Computing and Big Data Ecosystems Design | 1885/E-b · 2481/E-c | 2027-01-14 | 15:00 | ✓ |
| Complex Data in Health | 1885/E-b · 2481/E-c | 2027-01-14 | 10:00 | ✓ |
| Data Mining and Time Series | 1885/E-b · 2481/E-c | 2027-01-15 | 15:00 | ✓ |
| Data Processes | 1885/E-b · 2481/E-c | 2027-01-20 | 15:00 | ✓ |
| E-Health: Promoting Active and Healthy Ageing | 2235/E-b · 2481/E-c | 2027-01-13 | 10:00 | ✓ |
| Generative AI and Language Models | 1885/E-b · 2481/E-c | 2027-01-15 | 15:00 | ✓ |
| I&E Basics : Introduction to Innovation and Entrepreneurship management | 1885/E-b · 2235/E-b · 2603/E-b | 2027-01-12 | 10:00 | ✓ |
| I&E Study | 1885/E-b · 2235/E-b · 2481/E-c | 2027-01-11 | 10:00 | ✓ |
| Open Data and Knowledge Graphs | 1885/E-b · 2481/E-c | 2027-01-12 | 15:00 | ✓ |
| Statistical Data Analysis | 1885/E-b · 2481/E-c | 2027-01-19 | 15:00 | ✓ |

**11/11** courses shared across programmes agree on date and start time.

Layout families contributing exam data: E-b, E-c.

## Assumptions in the data

| duration source | exams |
|---|---|
| `slot_default2h` | 39 |
| `explicit_range` | 4 |
| `curated` | 2 |

39 of 45 exams have an end time the source does not print; they are given a **2-hour** duration and flagged so the UI shows them as an assumption. An exam collision that exists only because of an assumed tail is shown as *possible* rather than *certain*.

34 of 88 sessions have a start/end derived from text position rather than from a printed cell rectangle. Check D above is what keeps that honest.

## Verdict

### error (0)

_none_

### warn (0)

_none_

