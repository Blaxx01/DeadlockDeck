import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { State } from 'ts-fsrs'
import { db, getGuessHighscore, getMeta, getQuizHighscore, getSettings, setMeta, type LastPatch, type ReviewRecord } from '../data/db'
import { DECKS, newIntroducedToday, type DeckId } from '../decks'
import { computeStreak, isInLearnScope, localDate } from '../srs/srs'

interface Props {
  onLearn: (deck: DeckId, extraNew?: number) => void
  onQuiz: () => void
  onGuess: () => void
  onShop: () => void
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

interface DeckStats {
  id: DeckId
  label: string
  total: number
  due: number
  fresh: number
  newLeft: number
  learned: number
}

function countDeck(ids: string[], reviews: Map<string, ReviewRecord>, now: number, newAllowed: number): Omit<DeckStats, 'id' | 'label'> {
  let due = 0
  let fresh = 0
  let learned = 0
  for (const id of ids) {
    const r = reviews.get(id)
    if (!r) fresh++
    else if (r.due.getTime() <= now) due++
    // Per „Jetzt lernen“ vorgemerkte neue Karten sind fällig, aber noch nicht gelernt
    if (r && r.state !== State.New) learned++
  }
  return { total: ids.length, due, fresh, learned, newLeft: Math.max(0, Math.min(fresh, newAllowed)) }
}

const PATCH_NOTICE_DAYS = 7

async function recentPatch(now: number): Promise<LastPatch | null> {
  const last = await getMeta<LastPatch | null>('lastPatch', null)
  if (!last || now - last.at > PATCH_NOTICE_DAYS * 86_400_000) return null
  const dismissed = await getMeta<number>('lastPatchDismissed', 0)
  return dismissed === last.at ? null : last
}

/** „(A, B, C, D +2 weitere)“ */
function nameList(names: string[] | undefined): string {
  if (!names?.length) return ''
  const shown = names.slice(0, 4).join(', ')
  return ` (${shown}${names.length > 4 ? ` +${names.length - 4} weitere` : ''})`
}

function PatchNotice({ patch }: { patch: LastPatch }) {
  const date = new Date(patch.at).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })
  const parts = [
    patch.changed && `${patch.changed} geändert`,
    patch.added && `${patch.added} neu${nameList(patch.addedNames)}`,
    patch.removed && `${patch.removed} entfernt${nameList(patch.removedNames)}`,
  ].filter(Boolean).join(', ')
  return (
    <div className="panel patch-notice">
      <div className="row">
        <h2>Patch erkannt</h2>
        <button className="icon-btn" aria-label="Hinweis schließen" onClick={() => void setMeta('lastPatchDismissed', patch.at)}>✕</button>
      </div>
      <p className="small">
        Am {date}: {parts}. Geänderte Karten, die du schon gelernt hast, kommen in deiner nächsten Session dran –
        mit „vorher → nachher“ auf der Karte. Neue Karten kommen vor allen anderen neuen. Im Shop sind sie markiert.
      </p>
    </div>
  )
}

function useHomeStats() {
  const tick = useClockTick()
  return useLiveQuery(async () => {
    const settings = await getSettings()
    const reviews = new Map((await db.reviews.toArray()).map(r => [r.id, r]))
    const items = (await db.items.toArray()).filter(i => isInLearnScope(settings.slots.includes(i.slot), reviews.get(i.id)))
    const ids: Record<DeckId, string[]> = {
      items: items.map(i => i.id),
      abilities: (await db.abilities.toCollection().primaryKeys()) as string[],
      heroes: (await db.heroes.toCollection().primaryKeys()) as string[],
    }
    const now = Date.now()
    const days = await db.days.toArray()
    const today = days.find(d => d.date === localDate())
    const decks: DeckStats[] = DECKS.map(d => ({
      id: d.id,
      label: d.label,
      ...countDeck(ids[d.id], reviews, now, settings.newPerDay - newIntroducedToday(today, d.id)),
    }))
    return {
      settings,
      decks,
      totalAll: await db.items.count(),
      reviewedToday: today?.reviewed ?? 0,
      streak: computeStreak(days, settings.dailyGoal),
      lastSync: await getMeta<number>('lastSync', 0),
      quizHighscore: await getQuizHighscore(),
      // Hinweis auf erkannten Patch: 7 Tage lang, bis er weggeklickt wird
      patch: await recentPatch(now),
      guessHighscore: await getGuessHighscore(),
      heroCount: ids.heroes.length,
    }
  }, [tick])
}

function DeckRow({ deck, onLearn }: { deck: DeckStats; onLearn: Props['onLearn'] }) {
  const toLearn = deck.due + deck.newLeft
  return (
    <div className="deck-row">
      <div className="deck-info">
        <div className="deck-name">{deck.label}</div>
        <div className="muted small">
          {deck.total === 0
            ? 'Noch keine Daten – einmal mit Internet öffnen'
            : `${deck.due} fällig · ${deck.newLeft} neu · ${deck.learned}/${deck.total} gelernt`}
        </div>
      </div>
      {toLearn > 0 ? (
        <button className="primary" onClick={() => onLearn(deck.id)}>Lernen ({toLearn})</button>
      ) : deck.fresh > 0 ? (
        <button onClick={() => onLearn(deck.id, 10)} title="10 weitere neue Karten">+10 neue</button>
      ) : deck.total > 0 ? (
        <span className="good small">Erledigt</span>
      ) : null}
    </div>
  )
}

export function Home({ onLearn, onQuiz, onGuess, onShop, onSettings, syncing, syncError, imageProgress, onSync }: Props) {
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

  return (
    <div className="home">
      <header className="home-head">
        <h1>DeadlockDeck</h1>
        <button className="icon-btn" onClick={onSettings} aria-label="Einstellungen">⚙</button>
      </header>

      {s.patch && <PatchNotice patch={s.patch} />}

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

      <div className="panel">
        <h2>Karteikarten</h2>
        {s.decks.map(d => <DeckRow key={d.id} deck={d} onLearn={onLearn} />)}
      </div>

      <div className="panel deck">
        <div className="row">
          <h2>Quiz</h2>
          <span className="muted small">Highscore {s.quizHighscore}</span>
        </div>
        <p className="muted small">10 Fragen: Bild, Effekt, Zahlen und Build-Pfad – schnell antworten gibt Bonus.</p>
        <button onClick={onQuiz}>Quiz starten</button>
      </div>

      {s.heroCount >= 4 && (
        <div className="panel deck">
          <div className="row">
            <h2>Hero erraten</h2>
            <span className="muted small">Highscore {s.guessHighscore}</span>
          </div>
          <p className="muted small">10 Heroes pro Runde – als Silhouette, Ausschnitt, unscharf oder an einer Fähigkeit. Aufdecken und Joker kosten Punkte.</p>
          <button onClick={onGuess}>Hero erraten starten</button>
        </div>
      )}

      <div className="panel deck">
        <h2>Shop</h2>
        <p className="muted small">Alle Items wie im Ingame-Shop zum Nachschlagen – mit Suche nach Name oder Effekt.</p>
        <button onClick={onShop}>Shop öffnen</button>
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
