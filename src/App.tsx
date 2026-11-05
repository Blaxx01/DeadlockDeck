import { useCallback, useEffect, useRef, useState } from 'react'
import { db, getMeta, setMeta } from './data/db'
import { needsAutoSync, prewarmImages, syncItems, waitForServiceWorker } from './data/sync'
import { Home } from './views/Home'
import { Learn } from './views/Learn'
import { SettingsView } from './views/SettingsView'

type View = { name: 'home' } | { name: 'learn'; extraNew?: number } | { name: 'settings' }

export default function App() {
  const [view, setView] = useState<View>({ name: 'home' })
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [imageProgress, setImageProgress] = useState<{ done: number; total: number } | null>(null)
  const syncingRef = useRef(false)

  const cachingRef = useRef(false)

  /** Lädt alle Item-Bilder in den Offline-Cache des Service Workers. */
  const cacheImages = useCallback(async () => {
    if (cachingRef.current) return
    cachingRef.current = true
    try {
      if (!(await waitForServiceWorker())) return
      const lastSync = await getMeta<number>('lastSync', 0)
      const urls = (await db.items.toArray()).map(i => i.image).filter((u): u is string => !!u)
      setImageProgress({ done: 0, total: urls.length })
      const { failed } = await prewarmImages(urls, (done, total) => setImageProgress({ done, total }))
      if (failed === 0) await setMeta('imagesCachedFor', lastSync)
    } finally {
      cachingRef.current = false
    }
  }, [])

  const sync = useCallback(async () => {
    if (syncingRef.current) return
    syncingRef.current = true
    setSyncing(true)
    setSyncError(null)
    try {
      await syncItems()
      void cacheImages()
    } catch (e) {
      const offline = !navigator.onLine
      setSyncError(offline
        ? 'Offline – Daten konnten nicht aktualisiert werden.'
        : `Laden fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      syncingRef.current = false
      setSyncing(false)
    }
  }, [cacheImages])

  useEffect(() => {
    async function maybeSync() {
      if (!navigator.onLine) return
      if (await needsAutoSync()) return void sync()
      // Bilder fehlen noch im Offline-Cache (z. B. erster Start oder abgebrochen)?
      const [lastSync, cachedFor] = await Promise.all([getMeta('lastSync', 0), getMeta('imagesCachedFor', -1)])
      if (lastSync && cachedFor !== lastSync) void cacheImages()
    }
    void maybeSync()
    window.addEventListener('online', maybeSync)
    return () => window.removeEventListener('online', maybeSync)
  }, [sync, cacheImages])

  const goHome = useCallback(() => setView({ name: 'home' }), [])

  return (
    <main className="app">
      {view.name === 'home' && (
        <Home
          onLearn={extraNew => setView({ name: 'learn', extraNew })}
          onSettings={() => setView({ name: 'settings' })}
          syncing={syncing}
          syncError={syncError}
          imageProgress={imageProgress}
          onSync={sync}
        />
      )}
      {view.name === 'learn' && <Learn onExit={goHome} extraNew={view.extraNew} />}
      {view.name === 'settings' && (
        <SettingsView onBack={goHome} onSync={sync} onCacheImages={cacheImages} syncing={syncing} />
      )}
    </main>
  )
}
