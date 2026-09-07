-- UPM Timetable snapshot schema.
--
-- Mirrors the shape of `public/bundle.json` (written by `npm run build:bundle`).
-- The data is a rebuilt-from-PDFs snapshot, not user content: `npm run
-- supabase:seed` wipes these tables and re-inserts the current bundle.
-- Apply with `supabase db push` or by pasting into the Supabase SQL editor.

create table if not exists programmes (
  code text primary key,
  short text not null,
  name text not null,
  lang text not null check (lang in ('es', 'en')),
  colour text not null
);

create table if not exists courses (
  key text primary key,
  name text not null,
  progs text[] not null default '{}',
  elective boolean not null default false
);

create table if not exists sessions (
  id bigint generated always as identity primary key,
  course_key text not null references courses (key) on delete cascade,
  prog text not null,
  sem text not null check (sem in ('1S', '3S')),
  weekday smallint not null check (weekday between 1 and 5),
  start_min smallint not null,
  end_min smallint not null check (end_min > start_min),
  room text,
  validity jsonb,
  inferred boolean not null default false
);
create index if not exists sessions_course_idx on sessions (course_key);

create table if not exists exams (
  id bigint generated always as identity primary key,
  course_key text not null references courses (key) on delete cascade,
  date date not null,
  start_min smallint not null,
  end_min smallint not null check (end_min > start_min),
  room text,
  slot text,
  assumed boolean not null default false,
  witnesses smallint not null default 1,
  progs text[] not null default '{}'
);
create index if not exists exams_course_idx on exams (course_key);
create index if not exists exams_date_idx on exams (date);

-- Bundle-level metadata: academicYear, builtAt, examWindow, assumptions.
create table if not exists meta (
  k text primary key,
  v jsonb not null
);

-- Public read-only access; writes go through the service-role seed script.
alter table programmes enable row level security;
alter table courses enable row level security;
alter table sessions enable row level security;
alter table exams enable row level security;
alter table meta enable row level security;

drop policy if exists "public read" on programmes;
drop policy if exists "public read" on courses;
drop policy if exists "public read" on sessions;
drop policy if exists "public read" on exams;
drop policy if exists "public read" on meta;

create policy "public read" on programmes for select using (true);
create policy "public read" on courses for select using (true);
create policy "public read" on sessions for select using (true);
create policy "public read" on exams for select using (true);
create policy "public read" on meta for select using (true);
