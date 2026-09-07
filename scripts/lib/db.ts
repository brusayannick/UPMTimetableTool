import { DatabaseSync } from 'node:sqlite'
import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

/** Create a fresh database from `schema.sql`. The build is always from scratch. */
export function createDb(path: string): DatabaseSync {
  rmSync(path, { force: true })
  rmSync(`${path}-journal`, { force: true })
  const db = new DatabaseSync(path)
  db.exec(readFileSync(join(here, 'schema.sql'), 'utf8'))
  return db
}

export function openDb(path: string): DatabaseSync {
  const db = new DatabaseSync(path, { readOnly: true })
  return db
}

/** Rows come back as null-prototype objects; this makes them ordinary records. */
export const rows = <T>(db: DatabaseSync, sql: string, ...params: unknown[]): T[] =>
  (db.prepare(sql).all(...(params as never[])) as unknown[]).map((r) => ({ ...(r as object) })) as T[]

export const one = <T>(db: DatabaseSync, sql: string, ...params: unknown[]): T | null => {
  const r = db.prepare(sql).get(...(params as never[]))
  return r === undefined ? null : ({ ...(r as object) } as T)
}
