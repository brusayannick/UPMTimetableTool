import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
export const ROOT = resolve(here, '..', '..')

export const INPUT_DIRS = [join(ROOT, 'timetables')]
export const DATA_DIR = join(ROOT, 'data')
export const EXTRACTED_DIR = join(DATA_DIR, 'extracted')
export const VISION_DIR = join(DATA_DIR, 'vision')
export const CURATION_DIR = join(DATA_DIR, 'curation')
export const PARSED_DIR = join(DATA_DIR, 'parsed')
export const REPORTS_DIR = join(DATA_DIR, 'reports')
export const DB_PATH = join(DATA_DIR, 'upm.sqlite')
export const BUNDLE_PATH = join(ROOT, 'public', 'bundle.json')

/** Repo-relative path, forward slashes, for stable cross-platform identity. */
export const relPath = (abs: string): string =>
  abs.startsWith(ROOT) ? abs.slice(ROOT.length + 1).replaceAll('\\', '/') : abs

/**
 * Stable filename-safe id for a source PDF. Deterministic and reversible enough
 * to eyeball, e.g. `timetables/2481_HMDA_MUID_schedule_2026-27_1S.pdf`
 * → `timetables--2481-hmda-muid-schedule-2026-27-1s`.
 */
export function slugFor(path: string): string {
  return relPath(resolve(path))
    .normalize('NFC')
    .replace(/\.pdf$/i, '')
    .replaceAll('/', '--')
    // Deaccent before stripping so `Máster` becomes `master`, not `m-ster`.
    // Existing ASCII slugs are unaffected.
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, '-')
    .replace(/-{3,}/g, '--')
    .replace(/^-+|-+$/g, '')
}
