import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { db, getMeta, getQuizHighscore, getSettings } from '../data/db'
import { computeStreak, localDate } from '../srs/srs'

interface Props {
  onLearn: (extraNew?: number) => void
  onQuiz: () => void
  onSettings: () => void
  syncing: boolean
  syncError: string | null
  imageProgress: { done: number; total: number } | null
  onSync: () => void
}

/** Zählt jede Minute und beim Zurückkehren in die App hoch, damit "fällig" aktuell bleibt. */
function useClockTick(): number {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const bump = () => setTick(t => t + 1)
    const id = window.setInterval(bump, 60_000)
    const onVisible = () => { if (document.visibilityState === 'visible') bump() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])
  return tick
}

function useHomeStats() {
  const tick = useClockTick()
  return useLiveQuery(async () => {
    const settings = await getSettings()
    const items = (await db.items.toArray()).filter(i => settings.slots.includes(i.slot))
    const reviews = new Map((await db.reviews.toArray()).map(r => [r.id, r]))
    const now = Date.now()
    let due = 0
    let fresh = 0
    for (const i of items) {
      const r = reviews.get(i.id)
      if (!r) fresh++
      else if (r.due.getTime() <= now) due++
    }
    const days = await db.days.toArray()
    const today = days.find(d => d.date === localDate())
    const newLeft = Math.max(0, Math.min(fresh, settings.newPerDay - (today?.newIntroduced ?? 0)))
    return {
      settings,
      total: items.length,
      totalAll: await db.items.count(),
      learned: items.length - fresh,
      due,
      fresh,
      newLeft,
      reviewedToday: today?.reviewed ?? 0,
      streak: computeStreak(days, settings.dailyGoal),
      lastSync: await getMeta<number>('lastSync', 0),
      quizHighscore: await getQuizHighscore(),
    }
  }, [tick])
}

export function Home({ onLearn, onQuiz, onSettings, syncing, syncError, imageProgress, onSync }: Props) {
  const s = useHomeStats()
  if (!s) return <div className="center muted">Lade…</div>

  if (s.totalAll === 0) {
    return (
      <div className="home">
        <h1>DeadlockDeck</h1>
        <div className="panel">
          <p>Noch keine Daten auf diesem Gerät.</p>
          {syncing ? <p className="muted">Lade Items von der Deadlock-API…</p> : (
            <button className="primary" onClick={onSync}>Daten herunterladen</button>
          )}
          {syncError && <p className="error">{syncError}</p>}
          {!navigator.onLine && <p className="muted small">Du bist offline. Für den ersten Start wird Internet gebraucht.</p>}
        </div>
      </div>
    )
  }

  const goalPct = Math.min(100, Math.round((s.reviewedToday / s.settings.dailyGoal) * 100))
  const toLearn = s.due + s.newLeft

  return (
    <div className="home">
      <header className="home-head">
        <h1>DeadlockDeck</h1>
        <button className="icon-btn" onClick={onSettings} aria-label="Einstellungen">⚙</button>
      </header>

      <div className="panel today">
        <div className="row">
          <div>
            <div className="big">{s.reviewedToday}<span className="muted"> / {s.settings.dailyGoal}</span></div>
            <div className="muted small">Tagesziel</div>
          </div>
          <div className="streak" title="Tage in Folge mit erreichtem Tagesziel">
            <div className="big">🔥 {s.streak}</div>
            <div className="muted small">Streak</div>
          </div>
        </div>
        <div className="goal-bar"><div style={{ width: `${goalPct}%` }} /></div>
      </div>

      <div className="panel deck">
        <h2>Items</h2>
        <div className="counts">
          <div><span className="big">{s.due}</span><span className="muted small">fällig</span></div>
          <div><span className="big">{s.newLeft}</span><span className="muted small">neu heute</span></div>
          <div><span className="big">{s.learned}</span><span className="muted small">von {s.total} gelernt</span></div>
        </div>
        {toLearn > 0 ? (
          <button className="primary" onClick={() => onLearn()}>Lernen ({toLearn})</button>
        ) : (
          <>
            <p className="good">Für heute alles erledigt.</p>
            {s.fresh > 0 && <button onClick={() => onLearn(10)}>10 weitere neue Karten</button>}
          </>
        )}
      </div>

      <div className="panel deck">
        <div className="row">
          <h2>Quiz</h2>
          <span className="muted small">Highscore {s.quizHighscore}</span>
        </div>
        <p className="muted small">10 Fragen: Bild, Effekt, Zahlen und Build-Pfad – schnell antworten gibt Bonus.</p>
        <button onClick={onQuiz}>Quiz starten</button>
      </div>

      <footer className="muted small sync-info">
        {syncing ? 'Aktualisiere Daten…' : `${s.totalAll} Items · Stand ${s.lastSync ? new Date(s.lastSync).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) : '–'}`}
        {imageProgress && imageProgress.done < imageProgress.total && (
          <div>Bilder für offline: {imageProgress.done} / {imageProgress.total}</div>
        )}
        {syncError && <div className="error">{syncError}</div>}
      </footer>
    </div>
  )
}
