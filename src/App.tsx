import { useCallback, useEffect, useRef, useState } from 'react'
import { db, getMeta, setMeta } from './data/db'
import { needsAutoSync, prewarmImages, syncItems, waitForServiceWorker } from './data/sync'
import { currentNav, pushNav, viewOf, type NavState, type View } from './nav'
import { Home } from './views/Home'
import { Learn } from './views/Learn'
import { Guess } from './views/Guess'
import { Quiz } from './views/Quiz'
import { SettingsView } from './views/SettingsView'
import { Shop } from './views/Shop'

export default function App() {
  // Nach einem Neuladen (z. B. App-Update) in derselben Ansicht weitermachen
  const [view, setView] = useState<View>(() => viewOf(currentNav()))
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
      const [items, heroes, abilities] = await Promise.all([db.items.toArray(), db.heroes.toArray(), db.abilities.toArray()])
      const urls = [
        ...items.map(i => i.image),
        ...heroes.flatMap(h => [h.image, h.smallImage]),
        ...abilities.map(a => a.image),
      ].filter((u): u is string => !!u)
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

  const navigate = useCallback((next: View) => {
    pushNav({ view: next })
    setView(next)
  }, [])

  /** Einen Schritt zurück im Verlauf – wie die Zurück-Geste */
  const goBack = useCallback(() => {
    if (currentNav().view) window.history.back()
    else setView({ name: 'home' })
  }, [])

  useEffect(() => {
    const onPop = (e: PopStateEvent) => setView(viewOf(e.state as NavState | null))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  return (
    <main className="app">
      {view.name === 'home' && (
        <Home
          onLearn={(deck, extraNew) => navigate({ name: 'learn', deck, extraNew })}
          onQuiz={() => navigate({ name: 'quiz' })}
          onGuess={() => navigate({ name: 'guess' })}
          onShop={() => navigate({ name: 'shop' })}
          onSettings={() => navigate({ name: 'settings' })}
          syncing={syncing}
          syncError={syncError}
          imageProgress={imageProgress}
          onSync={sync}
        />
      )}
      {view.name === 'learn' && <Learn deck={view.deck ?? 'items'} onExit={goBack} extraNew={view.extraNew} />}
      {view.name === 'quiz' && <Quiz onExit={goBack} />}
      {view.name === 'guess' && <Guess onExit={goBack} />}
      {view.name === 'shop' && <Shop onBack={goBack} />}
      {view.name === 'settings' && (
        <SettingsView onBack={goBack} onSync={sync} onCacheImages={cacheImages} syncing={syncing} />
      )}
    </main>
  )
}
