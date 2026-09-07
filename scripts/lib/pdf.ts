/**
 * The only pdfjs surface in the project.
 *
 * Everything downstream consumes the committed `data/extracted/*.json` files, so
 * the pdfjs API risk is contained here. Two facts about pdfjs 6.x that this
 * module depends on and asserts:
 *
 *  1. `OPS.constructPath` args are `[paintOp, subpaths[], minMax]` where `minMax`
 *     is a `Float32Array` bounding box `[minX, minY, maxX, maxY]` in the path's
 *     local user space. For the axis-aligned `re` rectangles in this corpus the
 *     bbox *is* the rectangle.
 *  2. Fills in the original UPM PDFs happen under an identity CTM, so `minMax`
 *     is used verbatim there. Web-printed PDFs (the MUCD/MUIA timetables) draw
 *     under scale/translate CTMs; those are composed onto the bbox corners.
 *     Anything else (rotation, skew) throws rather than silently emitting wrong
 *     geometry.
 *
 * pdfjs also resolves per-font `ToUnicode` CMaps for us, which is what makes
 * `exams/January_26.pdf` readable at all.
 */

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { PdfExtraction, Rect, Run } from './types.ts'

/** Round to 2 dp so committed extraction files produce stable diffs. */
const r2 = (n: number): number => Math.round(n * 100) / 100

type Matrix = [number, number, number, number, number, number]

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]

/** `a` applied first, then `b`. */
function mul(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[1] * b[2],
    a[0] * b[1] + a[1] * b[3],
    a[2] * b[0] + a[3] * b[2],
    a[2] * b[1] + a[3] * b[3],
    a[4] * b[0] + a[5] * b[2] + b[4],
    a[4] * b[1] + a[5] * b[3] + b[5],
  ]
}

const isIdentity = (m: Matrix): boolean =>
  m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0

export class PdfShapeError extends Error {}

/**
 * Extract positioned text runs and filled rectangles from a PDF.
 *
 * Single-page files take the default: exactly one page is required, and a
 * multi-page replacement needs a deliberate decision, not a silent
 * first-page-only read. Pass `pages` (0-based) for web-printed PDFs whose
 * timetable lives on one page among website-chrome pages; the remaining pages
 * are then deliberately excluded, and the source spec records why.
 *
 * Throws `PdfShapeError` if the pdfjs operator-list shape differs from what this
 * module was verified against.
 */
export async function extractPdf(
  path: string,
  scriptHash: string,
  opts: { pages?: number[] } = {},
): Promise<PdfExtraction> {
  const bytes = await readFile(path)
  const sha256 = createHash('sha256').update(bytes).digest('hex')

  // `isEvalSupported` is honoured at runtime but absent from the published typings.
  const doc = await getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    verbosity: 0,
  } as Parameters<typeof getDocument>[0]).promise

  let wanted: number[]
  if (opts.pages) {
    wanted = opts.pages
    for (const p of wanted) {
      if (p < 0 || p >= doc.numPages) {
        throw new PdfShapeError(`${path}: page index ${p} out of range (0..${doc.numPages - 1})`)
      }
    }
  } else {
    if (doc.numPages !== 1) {
      throw new PdfShapeError(`${path}: expected 1 page, got ${doc.numPages}`)
    }
    wanted = [0]
  }

  const runs: Run[] = []
  const rects: Rect[] = []
  let view: [number, number, number, number] = [0, 0, 0, 0]

  for (const pageIndex of wanted) {
    const page = await doc.getPage(pageIndex + 1)
    if (pageIndex === wanted[0]) view = (page.view as number[]).map(r2) as [number, number, number, number]

    // ── text runs ─────────────────────────────────────────────────────────────
    // `disableNormalization` keeps ligatures/whitespace verbatim: the double
    // spaces in `Complex  Data in Health` and `Aula  6202` are real signal for the
    // alias curation, so we must not let pdfjs tidy them away.
    const tc = await page.getTextContent({ disableNormalization: true })
    for (const item of tc.items) {
      if (!('str' in item)) continue
      if (item.str === '' || item.str.trim() === '') continue
      const tr = item.transform as number[]
      if (tr.length !== 6) throw new PdfShapeError(`${path}: text transform length ${tr.length}`)
      runs.push({
        i: runs.length,
        x: r2(tr[4]!),
        y: r2(tr[5]!),
        w: r2(item.width),
        h: r2(item.height),
        text: item.str,
        font: item.fontName,
        size: r2(Math.abs(tr[3]!) || Math.abs(tr[0]!)),
      })
    }

    // ── filled rectangles ─────────────────────────────────────────────────────
    const ol = await page.getOperatorList()
    let ctm: Matrix = [...IDENTITY]
    const ctmStack: Matrix[] = []
    let fill: string | null = null
    const fillStack: (string | null)[] = []

    for (let i = 0; i < ol.fnArray.length; i++) {
      const fn = ol.fnArray[i]!
      const args = ol.argsArray[i] as unknown[]

      if (fn === OPS.save) {
        ctmStack.push([...ctm])
        fillStack.push(fill)
      } else if (fn === OPS.restore) {
        ctm = ctmStack.pop() ?? [...IDENTITY]
        fill = fillStack.pop() ?? null
      } else if (fn === OPS.transform) {
        const m = (args as number[]).slice(0, 6) as Matrix
        ctm = mul(m, ctm)
      } else if (fn === OPS.setFillRGBColor) {
        // pdfjs 6 normalises setFillGray / setFillCMYKColor / setFillColorN into
        // this single op with one CSS hex string argument.
        const hex = args[0]
        if (typeof hex !== 'string') {
          throw new PdfShapeError(`${path}: setFillRGBColor arg is ${typeof hex}, expected string`)
        }
        fill = hex.toLowerCase()
      } else if (fn === OPS.constructPath) {
        const paintOp = args[0]
        if (paintOp !== OPS.fill && paintOp !== OPS.eoFill) continue
        const minMax = args[2]
        if (!minMax || typeof (minMax as ArrayLike<number>).length !== 'number' ||
            (minMax as ArrayLike<number>).length !== 4) {
          throw new PdfShapeError(
            `${path}: constructPath minMax has shape ${JSON.stringify(minMax)}; ` +
            `pdfjs API changed — see scripts/lib/pdf.ts header`,
          )
        }
        const bb = minMax as ArrayLike<number>
        // The bbox is in the path's local user space. Under an identity CTM
        // that is the page space; under a scale/translate CTM (web-printed
        // PDFs) the corners are composed through it. Rotation or skew is
        // refused: an axis-aligned bbox would no longer be axis-aligned.
        let x0 = bb[0]!, y0 = bb[1]!, x1 = bb[2]!, y1 = bb[3]!
        if (!isIdentity(ctm)) {
          if (ctm[1] !== 0 || ctm[2] !== 0) {
            throw new PdfShapeError(
              `${path}: fill under rotating/skewing CTM ${JSON.stringify(ctm)}; ` +
              `see scripts/lib/pdf.ts header`,
            )
          }
          const [a, , , d, e, f] = ctm
          const xs = [x0, x1].map((x) => a * x + e)
          const ys = [y0, y1].map((y) => d * y + f)
          x0 = Math.min(...xs)!
          x1 = Math.max(...xs)!
          y0 = Math.min(...ys)!
          y1 = Math.max(...ys)!
        }
        rects.push({
          i: rects.length,
          x: r2(Math.min(x0, x1)),
          y: r2(Math.min(y0, y1)),
          w: r2(Math.abs(x1 - x0)),
          h: r2(Math.abs(y1 - y0)),
          fill,
          op: paintOp === OPS.eoFill ? 'f*' : 'f',
        })
      }
    }
  }

  const { version } = await import('pdfjs-dist/package.json', { with: { type: 'json' } })
    .then((m) => m.default as { version: string })

  return {
    source: { path, sha256, bytes: bytes.length },
    extractor: { name: 'pdfjs', version, scriptHash },
    page: { index: wanted[0]!, count: doc.numPages, view },
    imageOnly: runs.length === 0,
    runs,
    rects,
  }
}
