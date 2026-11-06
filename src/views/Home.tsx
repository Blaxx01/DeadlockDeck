import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { State } from 'ts-fsrs'
import { RankBadge } from '../components/RankBadge'
import {
  db, getBuildBests, getGuessHighscore, getMeta, getQuizHighscore, getSettings, getSprintHighscores, getSurvivalHighscore, setMeta,
  type DayRecord, type LastPatch, type ReviewRecord,
} from '../data/db'
import { DECKS, newIntroducedToday, REVERSE_NEW_PER_DAY, reverseIdsFor, reverseIntroducedToday, type DeckId } from '../decks'
import { allHeroMastery, MAX_STARS } from '../game/heroMastery'
import { ALL_MISSIONS_BONUS, checkDailyBonuses, dailyStatus, MISSION_SOULS, type DailyStatus } from '../game/missions'
import { rankForSouls, rankLabel, type RankAsset } from '../game/ranks'
import { DECAY_GRACE_DAYS, DECAY_SOULS, daysWithoutLearning, getSoulsTotal, lastActiveDate } from '../game/souls'
import { getWeaknesses, WEAK_DAYS, type Weakness } from '../game/weakness'
import { computeStreakState, isInLearnScope, localDate, type StreakState } from '../srs/srs'

interface Props {
  onLearn: (deck: DeckId, extraNew?: number) => void
  onQuiz: () => void
  onGuess: () => void
  onBuilds: () => void
  onSprint: () => void
  onSurvival: () => void
  onWeak: () => void
  onShop: () => void
  onHeroes: () => void
  onStats: () => void
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
  /** Text, solange das Deck noch keine Karten hat */
  emptyText: string
}

/** Rückrichtung: fällige und heute noch mögliche neue Karten (eigenes Limit) */
function countReverse(deck: DeckId, ids: string[], reviews: Map<string, ReviewRecord>, now: number, today: DayRecord | undefined) {
  const reverse = reverseIdsFor(deck, ids, reviews)
  let due = 0
  let fresh = 0
  for (const id of reverse) {
    const r = reviews.get(id)
    if (!r) fresh++
    else if (r.due.getTime() <= now) due++
  }
  return { due, newLeft: Math.max(0, Math.min(fresh, REVERSE_NEW_PER_DAY - reverseIntroducedToday(today, deck))) }
}

function countDeck(ids: string[], reviews: Map<string, ReviewRecord>, now: number, newAllowed: number): Omit<DeckStats, 'id' | 'label' | 'emptyText'> {
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

/** Warnung vor dem Rang-Verfall ab dem 4. Tag ohne Lernen */
function decayWarning(daysWithout: number): string | undefined {
  const start = DECAY_GRACE_DAYS + 1
  if (daysWithout < 4) return undefined
  if (daysWithout < start) {
    const left = start - daysWithout
    return `Noch ${left} Tag${left > 1 ? 'e' : ''} ohne Lernen, dann beginnt der Rang-Verfall (−${DECAY_SOULS} ◆ pro Tag).`
  }
  return `Rang-Verfall: −${DECAY_SOULS} ◆ pro Tag ohne Lernen – heute lernen stoppt ihn.`
}

interface RankCardProps {
  souls: number
  assets: RankAsset[]
  streak: StreakState
  warning?: string
  onStats: () => void
}

/** Rang-Karte – antippen öffnet die Statistik */
function RankCard({ souls, assets, streak, warning, onStats }: RankCardProps) {
  const rank = rankForSouls(souls)
  return (
    <div className="panel rank-card">
      <button className="rank-main" onClick={onStats}>
        <span className="rank-row">
          <RankBadge rank={rank} assets={assets} />
          <span className="rank-info">
            <span className="rank-name">{rankLabel(rank, assets)}</span>
            <span className="muted small">◆ {souls.toLocaleString('de-DE')} Souls</span>
          </span>
          <span className="streak" title="Tage in Folge mit erreichtem Tagesziel – Streak-Schutz fängt einen verpassten Tag ab">
            <span className="big">🔥 {streak.streak}</span>
            <span className="muted small">
              {streak.shields > 0 ? <span aria-label={`${streak.shields} Streak-Schutz`}>{'🛡'.repeat(streak.shields)}</span> : 'Streak'}
            </span>
          </span>
        </span>
        <span className="goal-bar rank-bar"><span style={{ width: `${Math.round(rank.progress * 100)}%` }} /></span>
        <span className="rank-foot muted small">
          <span>
            {rank.next
              ? `noch ${(rank.next.souls - souls).toLocaleString('de-DE')} ◆ bis ${rankLabel(rank.next, assets)}`
              : 'Höchster Rang erreicht'}
          </span>
          <span className="rank-more">Statistik ›</span>
        </span>
      </button>
      {warning && <p className="rank-warning">⚠ {warning}</p>}
    </div>
  )
}

function Missions({ daily, reviewed, goal }: { daily: DailyStatus; reviewed: number; goal: number }) {
  const goalPct = Math.min(100, Math.round((reviewed / goal) * 100))
  return (
    <div className="panel today">
      <div className="row">
        <h2>Heute</h2>
        <span className="muted small">Tagesziel {reviewed} / {goal}{daily.goalReached ? ' ✓' : ''}</span>
      </div>
      <div className="goal-bar"><div style={{ width: `${goalPct}%` }} /></div>
      {daily.missions.length > 0 && (
        <>
          <ul className="missions">
            {daily.missions.map(m => (
              <li key={m.def.id} className={m.done ? 'done' : undefined}>
                <span className="mission-check" aria-hidden="true">{m.done ? '✓' : '○'}</span>
                <span className="mission-title">{m.def.title}</span>
                <span className="mission-progress muted small">
                  {m.done ? '' : `${m.progress.toLocaleString('de-DE')} / ${m.def.target.toLocaleString('de-DE')}`}
                </span>
                <span className="mission-reward">+{MISSION_SOULS} ◆</span>
              </li>
            ))}
          </ul>
          <p className="muted small mission-bonus">
            {daily.bonus ? `🎉 Alle Missionen geschafft – +${ALL_MISSIONS_BONUS} ◆ Bonus` : `Alle drei: +${ALL_MISSIONS_BONUS} ◆ Bonus`}
          </p>
        </>
      )}
    </div>
  )
}

function useHomeStats() {
  const tick = useClockTick()
  // Missionen des Tages festhalten und offene Boni gutschreiben (z. B. nach dem ersten Sync)
  useEffect(() => { void checkDailyBonuses() }, [tick])
  return useLiveQuery(async () => {
    const settings = await getSettings()
    const reviews = new Map((await db.reviews.toArray()).map(r => [r.id, r]))
    const items = (await db.items.toArray()).filter(i => isInLearnScope(settings.slots.includes(i.slot), reviews.get(i.id)))
    const ids: Record<DeckId, string[]> = {
      items: items.map(i => i.id),
      abilities: (await db.abilities.toCollection().primaryKeys()) as string[],
      heroes: (await db.heroes.toCollection().primaryKeys()) as string[],
      counters: (await db.counters.toCollection().primaryKeys()) as string[],
    }
    // Counter-Daten kommen separat (wöchentlich) – eigener Hinweis, solange sie fehlen
    const countersError = await getMeta<string | null>('countersError', null)
    const emptyText = (deck: DeckId) => deck !== 'counters'
      ? 'Noch keine Daten – einmal mit Internet öffnen'
      : countersError
        ? 'Counter-Daten konnten nicht geladen werden – neuer Versuch beim nächsten Start mit Internet'
        : 'Counter-Daten werden geladen, sobald Internet da ist'
    const now = Date.now()
    const days = await db.days.toArray()
    const today = days.find(d => d.date === localDate())
    const decks: DeckStats[] = DECKS.map(d => {
      const normal = countDeck(ids[d.id], reviews, now, settings.newPerDay - newIntroducedToday(today, d.id))
      // Rückrichtung zählt bei „fällig“ und „neu“ mit (gelernt: nur die normalen Karten)
      const reverse = countReverse(d.id, ids[d.id], reviews, now, today)
      return {
        id: d.id, label: d.label, emptyText: emptyText(d.id),
        ...normal, due: normal.due + reverse.due, newLeft: normal.newLeft + reverse.newLeft,
      }
    })
    return {
      settings,
      decks,
      totalAll: await db.items.count(),
      reviewedToday: today?.reviewed ?? 0,
      streak: computeStreakState(days, settings.dailyGoal),
      souls: await getSoulsTotal(),
      ranks: await getMeta<RankAsset[]>('ranks', []),
      daily: await dailyStatus(),
      decayWarning: decayWarning(daysWithoutLearning(await lastActiveDate(), localDate())),
      buildBests: Object.keys(await getBuildBests()).length,
      // Schwächen: mit Fehlern in den letzten 14 Tagen und hartnäckige (ohne neue Fehler)
      weak: await getWeaknesses(new Date(), db, Number.POSITIVE_INFINITY),
      weakTraining: (await getWeaknesses()).length,
      lastSync: await getMeta<number>('lastSync', 0),
      quizHighscore: await getQuizHighscore(),
      // Hinweis auf erkannten Patch: 7 Tage lang, bis er weggeklickt wird
      patch: await recentPatch(now),
      guessHighscore: await getGuessHighscore(),
      // Sprint: bester Wert über alle Auswahlen
      sprintHighscore: Math.max(0, ...Object.values(await getSprintHighscores())),
      survivalHighscore: await getSurvivalHighscore(),
      // Build-Quiz: Heroes mit typischem Build (kommen wöchentlich mit der Statistik)
      buildCount: await db.builds.where('source').equals('typical').count(),
      heroCount: ids.heroes.length,
      heroStars: (await allHeroMastery()).reduce((sum, m) => sum + m.stars.length, 0),
    }
  }, [tick])
}

/** „3 Karten mit Fehlern in den letzten 14 Tagen · 2 hartnäckig“ */
function weakText(weak: readonly Weakness[]): string {
  const recent = weak.filter(w => w.count > 0).length
  const leeches = weak.filter(w => w.count === 0).length
  if (recent + leeches === 0) return `Keine Fehler in den letzten ${WEAK_DAYS} Tagen`
  return [
    recent > 0 && `${recent} ${recent === 1 ? 'Karte' : 'Karten'} mit Fehlern in den letzten ${WEAK_DAYS} Tagen`,
    leeches > 0 && `${leeches} hartnäckig`,
  ].filter(Boolean).join(' · ')
}

function DeckRow({ deck, onLearn }: { deck: DeckStats; onLearn: Props['onLearn'] }) {
  const toLearn = deck.due + deck.newLeft
  return (
    <div className="deck-row">
      <div className="deck-info">
        <div className="deck-name">{deck.label}</div>
        <div className="muted small">
          {deck.total === 0
            ? deck.emptyText
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

export function Home({
  onLearn, onQuiz, onGuess, onBuilds, onSprint, onSurvival, onWeak, onShop, onHeroes, onStats, onSettings,
  syncing, syncError, imageProgress, onSync,
}: Props) {
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

  return (
    <div className="home">
      <header className="home-head">
        <h1>DeadlockDeck</h1>
        <button className="icon-btn" onClick={onSettings} aria-label="Einstellungen">⚙</button>
      </header>

      {s.patch && <PatchNotice patch={s.patch} />}

      <RankCard souls={s.souls} assets={s.ranks} streak={s.streak} warning={s.decayWarning} onStats={onStats} />

      <Missions daily={s.daily} reviewed={s.reviewedToday} goal={s.settings.dailyGoal} />

      <div className="panel">
        <h2>Karteikarten</h2>
        {s.decks.map(d => <DeckRow key={d.id} deck={d} onLearn={onLearn} />)}
        <div className="deck-row weak-row">
          <div className="deck-info">
            <div className="deck-name">Schwächen</div>
            <div className="muted small">{weakText(s.weak)}</div>
          </div>
          {s.weakTraining > 0 && <button onClick={onWeak}>Schwächen üben ({s.weakTraining})</button>}
        </div>
      </div>

      <div className="panel">
        <h2>Spielen</h2>
        <div className="mode-tiles">
          <button className="mode-tile" onClick={onQuiz} aria-label="Quiz starten">
            <span className="mode-name">Quiz</span>
            <span className="muted small">Highscore {s.quizHighscore.toLocaleString('de-DE')}</span>
          </button>
          <button className="mode-tile" onClick={onSprint} aria-label="Sprint starten">
            <span className="mode-name">Sprint</span>
            <span className="muted small">60 s · Highscore {s.sprintHighscore.toLocaleString('de-DE')}</span>
          </button>
          <button className="mode-tile" onClick={onSurvival} aria-label="Überleben starten">
            <span className="mode-name">Überleben</span>
            <span className="muted small">3 Leben · Highscore {s.survivalHighscore.toLocaleString('de-DE')}</span>
          </button>
          {s.heroCount >= 4 && (
            <button className="mode-tile" onClick={onGuess} aria-label="Hero erraten starten">
              <span className="mode-name">Hero erraten</span>
              <span className="muted small">Highscore {s.guessHighscore.toLocaleString('de-DE')}</span>
            </button>
          )}
          <button className="mode-tile" onClick={onBuilds} disabled={s.buildCount === 0} aria-label="Build-Quiz starten">
            <span className="mode-name">Build-Quiz</span>
            <span className="muted small">
              {s.buildCount === 0 ? 'Daten werden geladen' : `${s.buildBests} Bestwert${s.buildBests === 1 ? '' : 'e'}`}
            </span>
          </button>
        </div>
      </div>

      <div className="panel">
        <h2>Nachschlagen &amp; Fortschritt</h2>
        <div className="mode-tiles three">
          <button className="mode-tile" onClick={onShop} aria-label="Shop öffnen">
            <span className="mode-name">Shop</span>
            <span className="muted small">Sammelalbum</span>
          </button>
          {s.heroCount > 0 && (
            <button className="mode-tile" onClick={onHeroes} aria-label="Hero-Meisterschaft öffnen">
              <span className="mode-name">Heroes</span>
              <span className="muted small"><span className="star-on">★</span> {s.heroStars.toLocaleString('de-DE')} / {(s.heroCount * MAX_STARS).toLocaleString('de-DE')}</span>
            </button>
          )}
          <button className="mode-tile" onClick={onStats} aria-label="Statistik öffnen">
            <span className="mode-name">Statistik</span>
            <span className="muted small">Lerntage</span>
          </button>
        </div>
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
