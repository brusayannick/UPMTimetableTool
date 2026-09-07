/**
 * Mirror `public/bundle.json` into Supabase Postgres.
 *
 * The bundle is a rebuilt-from-PDFs snapshot, so the sync is destructive by
 * design: child tables first, then parents, then a fresh insert in dependency
 * order. Run `npm run data` first so the bundle is current.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run supabase:seed
 *
 * Reads `.env` as a fallback (simple `KEY=VALUE` lines only). No dependencies —
 * plain PostgREST calls with the global fetch.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

type BundleCourse = {
  key: string
  name: string
  progs: string[]
  elective?: boolean
  sessions: {
    prog: string
    sem: string
    d: number
    s: number
    e: number
    room: string | null
    v?: { label: string; from: string; to: string }
    inferred?: boolean
  }[]
  exams: {
    date: string
    s: number
    e: number
    room: string | null
    slot: string | null
    assumed?: boolean
    witnesses: number
    progs: string[]
  }[]
}

type Bundle = {
  schemaVersion: number
  builtAt: string
  academicYear: string
  assumptions: { defaultExamMinutes: number }
  examWindow: { from: string; to: string }
  programmes: { code: string; short: string; name: string; lang: string; colour: string }[]
  courses: BundleCourse[]
}

const here = fileURLToPath(new URL('.', import.meta.url))
const root = join(here, '..')

try {
  for (const line of readFileSync(join(root, '.env'), 'utf8').split('\n')) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line)
    if (m && m[1] && !process.env[m[1]]) process.env[m[1]] = m[2]
  }
} catch {
  // No .env — environment variables must be set directly.
}

const url = (process.env.SUPABASE_URL ?? '').replace(/\/$/, '')
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
if (!url || !serviceKey) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (env or .env). See .env.example.')
  process.exit(1)
}

let bundle: Bundle
try {
  bundle = JSON.parse(readFileSync(join(root, 'public', 'bundle.json'), 'utf8')) as Bundle
  if (!Array.isArray(bundle.courses)) throw new Error('no courses array')
} catch {
  console.error('public/bundle.json missing or stale — run `npm run data` first.')
  process.exit(1)
}

const headers: Record<string, string> = {
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
  'Content-Type': 'application/json',
  Prefer: 'return=minimal',
}

// Preflight: the migration must be applied before anything else.
{
  const res = await fetch(`${url}/rest/v1/programmes?select=code&limit=1`, { headers })
  const body = await res.text()
  if (res.status === 404 && body.includes('PGRST205')) {
    console.error(
      'Supabase tables are missing — apply supabase/migrations/0001_schema.sql first:\n' +
        '  Supabase dashboard → SQL Editor → New query → paste the file → Run.\n' +
        'Then re-run `npm run supabase:seed`.',
    )
    process.exit(1)
  }
  if (!res.ok) {
    console.error(`Supabase preflight failed: ${res.status} ${body}`)
    process.exit(1)
  }
}

async function rest(method: string, table: string, body: unknown, query = ''): Promise<void> {
  const res = await fetch(`${url}/rest/v1/${table}${query}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) {
    throw new Error(`${method} ${table}${query}: ${res.status} ${await res.text()}`)
  }
}

async function insert(table: string, rows: Record<string, unknown>[]): Promise<void> {
  for (let i = 0; i < rows.length; i += 500) {
    await rest('POST', table, rows.slice(i, i + 500))
  }
}

// Wipe in child → parent order (sessions/exams reference courses).
// Each filter matches every row of its table (PK columns are never null).
for (const [table, filter] of [
  ['exams', '?id=not.is.null'],
  ['sessions', '?id=not.is.null'],
  ['courses', '?key=not.is.null'],
  ['programmes', '?code=not.is.null'],
  ['meta', '?k=not.is.null'],
] as const) {
  await rest('DELETE', table, undefined, filter)
}

await insert(
  'programmes',
  bundle.programmes.map((p) => ({
    code: p.code,
    short: p.short,
    name: p.name,
    lang: p.lang,
    colour: p.colour,
  })),
)

await insert(
  'courses',
  bundle.courses.map((c) => ({
    key: c.key,
    name: c.name,
    progs: c.progs,
    elective: c.elective === true,
  })),
)

await insert(
  'sessions',
  bundle.courses.flatMap((c) =>
    c.sessions.map((s) => ({
      course_key: c.key,
      prog: s.prog,
      sem: s.sem,
      weekday: s.d,
      start_min: s.s,
      end_min: s.e,
      room: s.room ?? null,
      validity: s.v ?? null,
      inferred: s.inferred === true,
    })),
  ),
)

await insert(
  'exams',
  bundle.courses.flatMap((c) =>
    c.exams.map((e) => ({
      course_key: c.key,
      date: e.date,
      start_min: e.s,
      end_min: e.e,
      room: e.room ?? null,
      slot: e.slot ?? null,
      assumed: e.assumed === true,
      witnesses: e.witnesses,
      progs: e.progs,
    })),
  ),
)

await insert('meta', [
  { k: 'academicYear', v: bundle.academicYear },
  { k: 'builtAt', v: bundle.builtAt },
  { k: 'examWindow', v: bundle.examWindow },
  { k: 'assumptions', v: bundle.assumptions },
  { k: 'schemaVersion', v: bundle.schemaVersion },
])

console.log(
  `seeded ${bundle.programmes.length} programmes · ${bundle.courses.length} courses · ` +
    `${bundle.courses.reduce((n, c) => n + c.sessions.length, 0)} sessions · ` +
    `${bundle.courses.reduce((n, c) => n + c.exams.length, 0)} exams → ${url}`,
)
