/**
 * Stage 1: PDF → `data/extracted/<slug>.json` (committed).
 *
 * Separate from parsing on purpose: parser iteration never re-reads a PDF, a
 * parser change shows up as a reviewable data diff, and the extraction files are
 * the fixtures for the geometry unit tests.
 *
 *   node scripts/extract.ts            write
 *   node scripts/extract.ts --check    re-extract in memory, diff, never write
 */

import { createHash } from 'node:crypto'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { loadSources } from './lib/curation.ts'
import { extractPdf } from './lib/pdf.ts'
import { INPUT_DIRS, EXTRACTED_DIR, VISION_DIR, relPath, slugFor } from './lib/paths.ts'

const check = process.argv.includes('--check')

async function listPdfs(): Promise<string[]> {
  const out: string[] = []
  for (const dir of INPUT_DIRS) {
    for (const name of await readdir(dir)) {
      if (name.toLowerCase().endsWith('.pdf')) out.push(join(dir, name))
    }
  }
  return out.sort()
}

async function main(): Promise<void> {
  // The extraction script must never be able to overwrite a hand-transcribed
  // vision artefact. Machine data and human data stay physically separate.
  if (EXTRACTED_DIR === VISION_DIR) {
    throw new Error('EXTRACTED_DIR and VISION_DIR must differ')
  }

  const scriptHash = createHash('sha256')
    .update(await readFile(new URL('./lib/pdf.ts', import.meta.url)))
    .digest('hex')
    .slice(0, 16)

  const pdfs = await listPdfs()
  const manifest: Record<string, { sha256: string; bytes: number; runs: number; rects: number; imageOnly: boolean }> = {}
  let changed = 0

  // Multi-page web prints declare their content pages in sources.json; anything
  // else must be single-page, so an undeclared multi-page file fails loudly.
  // Paths are NFC-normalised: macOS returns NFD filenames from readdir while
  // the curation JSON is NFC, and without this the lookup silently misses.
  let pagesByPath = new Map<string, number[] | undefined>()
  try {
    pagesByPath = new Map(loadSources().map((s) => [s.path.normalize('NFC'), s.pages]))
  } catch {
    // No curation yet (first bring-up): every file must be single-page.
  }

  for (const path of pdfs) {
    const ex = await extractPdf(path, scriptHash, { pages: pagesByPath.get(relPath(path).normalize('NFC')) })
    const slug = slugFor(path)
    const outPath = join(EXTRACTED_DIR, `${slug}.json`)
    if (outPath.startsWith(VISION_DIR)) throw new Error(`refusing to write into ${VISION_DIR}`)

    const json = `${JSON.stringify(ex, null, 1)}\n`
    const prev = await readFile(outPath, 'utf8').catch(() => null)
    if (prev !== json) {
      changed++
      if (check) {
        console.error(`✗ ${slug}: extraction differs from committed file`)
      } else {
        await writeFile(outPath, json)
      }
    }

    manifest[slug] = {
      sha256: ex.source.sha256,
      bytes: ex.source.bytes,
      runs: ex.runs.length,
      rects: ex.rects.length,
      imageOnly: ex.imageOnly,
    }
    const flag = ex.imageOnly ? ' IMAGE-ONLY' : ''
    console.log(
      `${String(ex.runs.length).padStart(4)} runs ${String(ex.rects.length).padStart(4)} rects  ${basename(path)}${flag}`,
    )
  }

  const manifestJson = `${JSON.stringify({ scriptHash, files: manifest }, null, 1)}\n`
  const manifestPath = join(EXTRACTED_DIR, '_manifest.json')
  if (!check) await writeFile(manifestPath, manifestJson)

  const images = Object.values(manifest).filter((m) => m.imageOnly).length
  console.log(`\n${pdfs.length} PDFs · ${images} image-only · ${changed} changed`)

  if (check && changed > 0) {
    console.error(`\n${changed} extraction file(s) out of date — run \`npm run extract\``)
    process.exit(1)
  }
}

await main()
