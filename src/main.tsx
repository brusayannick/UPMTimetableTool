import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import './index.css'
import type { Bundle } from './data/types.ts'

/**
 * The whole dataset is one 24 kB JSON file written by the build pipeline, so there is
 * no backend, no loading skeleton worth building, and no code splitting.
 */
function Boot() {
  const [bundle, setBundle] = useState<Bundle | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}bundle.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
        return r.json() as Promise<Bundle>
      })
      .then((b) => {
        if (b.schemaVersion !== 1) throw new Error(`unsupported bundle schemaVersion ${b.schemaVersion}`)
        if (!Array.isArray(b.courses) || b.courses.length === 0) throw new Error('bundle contains no courses')
        setBundle(b)
      })
      .catch((err: unknown) => setError((err as Error).message))
  }, [])

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="panel max-w-md px-4 py-3">
          <h1 className="text-[14px] font-semibold">Could not load the timetable data</h1>
          <p className="mt-1 text-[12px]" style={{ color: 'var(--text-dim)' }}>
            {error}
          </p>
          <p className="mt-2 text-[12px]" style={{ color: 'var(--text-dim)' }}>
            <code>public/bundle.json</code> is generated from the PDFs. Run{' '}
            <code>npm run data</code> to build it.
          </p>
        </div>
      </div>
    )
  }

  if (!bundle) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-[12px]" style={{ color: 'var(--text-faint)' }}>
          Loading…
        </p>
      </div>
    )
  }

  return <App bundle={bundle} />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Boot />
  </StrictMode>,
)
