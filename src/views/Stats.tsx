import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect } from 'react'
import { LearnCalendar } from '../components/LearnCalendar'
import { MapSymbolIcon } from '../components/MapCanvas'
import { MasteryBar, MasteryLegend } from '../components/Mastery'
import { SoulsChart } from '../components/SoulsChart'
import { localDate, parseLocalDate } from '../data/dates'
import { db, getSettings } from '../data/db'
import { DECKS, reverseId, type DeckId } from '../decks'
import { allHeroMastery, MAX_STARS } from '../game/heroMastery'
import { atLeast, countMastery, MASTERY_MEDAL, masteryText } from '../game/mastery'
import { describeCards, getLeeches, LEECH_LAPSES } from '../game/weakness'
import { InlineNote } from '../components/Notes'
import { getLaneSummary, PATRON_LABEL, PATRONS, TROPHY_WINS, type LaneSummary } from '../game/laneAttack'
import type { HeroCard } from '../data/model'
import { getSoulsTotal } from '../game/souls'
import { calendarWeeks, learningTotals, soulsSeries } from '../game/stats'
import { computeStreakState } from '../srs/srs'

interface Props {
  onBack: () => void
  onHeroes: () => void
}

async function loadStats() {
  const settings = await getSettings()
  const goal = settings.dailyGoal
  const today = localDate()
  const [days, entries, reviewList, heroes, souls, lanes] = await Promise.all([
    db.days.toArray(),
    db.souls.toArray(),
    db.reviews.toArray(),
    allHeroMastery(),
    getSoulsTotal(),
    getLaneSummary(),
  ])
  const reviews = new Map(reviewList.map(r => [r.id, r]))
  const ids: Record<DeckId, string[]> = {
    items: (await db.items.toCollection().primaryKeys()) as string[],
    abilities: (await db.abilities.toCollection().primaryKeys()) as string[],
    heroes: (await db.heroes.toCollection().primaryKeys()) as string[],
    counters: (await db.counters.toCollection().primaryKeys()) as string[],
  }
  const streak = computeStreakState(days, goal)
  const leeches = await getLeeches()
  return {
    goal,
    souls,
    streak,
    totals: learningTotals(days, goal),
    weeks: calendarWeeks(days, goal, today, streak.protectedDays),
    series: soulsSeries(entries, today),
    decks: DECKS.map(d => ({
      ...d,
      counts: countMastery(ids[d.id], reviews),
      // Rückrichtung: gelernte Karten (zählen nicht fürs Sammelalbum)
      reverseLearned: countMastery(ids[d.id].map(reverseId), reviews).learned,
    })),
    stars: heroes.reduce((sum, m) => sum + m.stars.length, 0),
    maxStars: heroes.length * MAX_STARS,
    leeches,
    leechCards: await describeCards(leeches.map(l => l.cardId)),
    lanes,
    // Siege je Held: Name und Bild der Heroes
    heroCards: new Map(heroes.map(m => [m.hero.id, m.hero])),
  }
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString('de-DE')} ${n === 1 ? one : many}`

/** Lane-Angriff: Siege, Niederlagen, Serie, je Patron mit Trophäen, Siege je Held */
function LaneStats({ lanes, heroCards }: { lanes: LaneSummary; heroCards: ReadonlyMap<string, HeroCard> }) {
  const played = lanes.wins + lanes.losses
  const byHero = Object.entries(lanes.byHero).sort((a, b) => b[1] - a[1]).slice(0, 6)
  return (
    <section className="panel">
      <h2>Lane-Angriff</h2>
      {played === 0 ? (
        <p className="muted small">
          Noch kein Tag entschieden. Schaffe an einem Tag alle drei Tagesmissionen – dann fällt der Patron und der Tag ist ein Sieg.
        </p>
      ) : (
        <>
          <div className="stat-tiles lane-tiles">
            <Tile label="Siege" value={`🏆 ${lanes.wins.toLocaleString('de-DE')}`} sub={plural(lanes.losses, 'Niederlage', 'Niederlagen')} />
            <Tile label="Siegesserie" value={lanes.streak.toLocaleString('de-DE')} sub={`beste: ${lanes.best.toLocaleString('de-DE')}`} />
          </div>
          <ul className="lane-patrons">
            {PATRONS.map(p => {
              const r = lanes.byPatron[p]
              const total = r.wins + r.losses
              return (
                <li key={p}>
                  <MapSymbolIcon kind="patron" size={24} />
                  <span className="lane-patron-name">{PATRON_LABEL[p]}</span>
                  <span className="small">{plural(r.wins, 'Sieg', 'Siege')} · {plural(r.losses, 'Niederlage', 'Niederlagen')}</span>
                  <span className={`lane-ratio${total ? '' : ' empty'}`} role="img"
                    aria-label={total ? `${Math.round((r.wins / total) * 100)} % gewonnen` : 'noch nicht gekämpft'}>
                    <span style={{ width: total ? `${(r.wins / total) * 100}%` : 0 }} />
                  </span>
                  <span className="lane-trophy-row" role="img"
                    aria-label={`Trophäen: ${TROPHY_WINS.filter(t => r.wins >= t).join(', ') || 'noch keine'}`}>
                    {TROPHY_WINS.map(t => <span key={t} className={`lane-trophy${r.wins >= t ? ' on' : ''}`}>🏅<small>{t}</small></span>)}
                  </span>
                </li>
              )
            })}
          </ul>
          {byHero.length > 0 && (
            <>
              <h3 className="lane-sub-head">Siege je Held des Tages</h3>
              <ul className="lane-heroes">
                {byHero.map(([id, wins]) => {
                  const hero = heroCards.get(id)
                  return (
                    <li key={id}>
                      <span className="hero-portrait small">{hero?.smallImage && <img src={hero.smallImage} alt="" draggable={false} />}</span>
                      <span>{hero?.name ?? id}</span>
                      <b>{plural(wins, 'Sieg', 'Siege')}</b>
                    </li>
                  )
                })}
              </ul>
            </>
          )}
          <p className="muted small">
            Gezählt werden Tage, an denen du gelernt oder gespielt hast. Ein Tag ohne Lernen unterbricht die Serie nicht.
            {lanes.saves > 0 && ` Der Rejuvenator hat deine Serie ${lanes.saves}× gerettet.`}
          </p>
        </>
      )}
    </section>
  )
}

function Tile({ value, label, sub }: { value: string; label: string; sub?: string }) {
  return (
    <div className="stat-tile">
      <span className="stat-label small muted">{label}</span>
      <span className="stat-value">{value}</span>
      {sub && <span className="small muted">{sub}</span>}
    </div>
  )
}

const fmt = (n: number) => n.toLocaleString('de-DE')

export function Stats({ onBack, onHeroes }: Props) {
  const s = useLiveQuery(loadStats, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onBack() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onBack])

  if (!s) return <div className="center muted">Lade…</div>

  return (
    <div className="stats-page">
      <header className="home-head">
        <button className="icon-btn" onClick={onBack} aria-label="Zurück">←</button>
        <h1>Statistik</h1>
        <span className="icon-btn" aria-hidden="true" />
      </header>

      <div className="stat-tiles">
        <Tile label="Streak" value={`🔥 ${s.streak.streak}`} sub={`längster: ${s.streak.longest} ${s.streak.longest === 1 ? 'Tag' : 'Tage'}`} />
        <Tile label="Lerntage" value={fmt(s.totals.learningDays)} sub={`${fmt(s.totals.goalDays)}× Tagesziel`} />
        <Tile label="Bewertungen" value={fmt(s.totals.reviews)} sub="Karten, je Tag einmal gezählt" />
        <button className="stat-tile stat-link" onClick={onHeroes} disabled={s.maxStars === 0}>
          <span className="stat-label small muted">Hero-Sterne ›</span>
          <span className="stat-value"><span className="star-on">★</span> {fmt(s.stars)}</span>
          <span className="small muted">von {fmt(s.maxStars)}</span>
        </button>
      </div>

      <section className="panel">
        <h2>Lerntage</h2>
        <LearnCalendar weeks={s.weeks} goal={s.goal} />
      </section>

      <LaneStats lanes={s.lanes} heroCards={s.heroCards} />

      <section className="panel">
        <div className="row">
          <h2>Souls-Verlauf</h2>
          <span className="small"><b>{fmt(s.souls)}</b> ◆</span>
        </div>
        <SoulsChart series={s.series} />
        <details className="table-view">
          <summary className="small">Als Tabelle</summary>
          <table className="small">
            <thead><tr><th>Tag</th><th>Änderung</th><th>Stand</th></tr></thead>
            <tbody>
              {s.series.filter(p => p.delta !== 0).reverse().map(p => (
                <tr key={p.date}>
                  <td>{parseLocalDate(p.date).toLocaleDateString('de-DE', { day: 'numeric', month: 'short', year: '2-digit' })}</td>
                  <td>{p.delta > 0 ? `+${fmt(p.delta)}` : `−${fmt(-p.delta)}`}</td>
                  <td>{fmt(p.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </section>

      <section className="panel">
        <h2>Karten je Deck</h2>
        {s.decks.map(d => (
          <div key={d.id} className="deck-mastery" role="group" aria-label={`${d.label}: ${masteryText(d.counts)}`}>
            <div className="row">
              <span className="deck-name">{d.label}</span>
              <span className="small">
                <b>{fmt(d.counts.learned)}</b>/{fmt(d.counts.total)} gelernt · <b>{fmt(d.counts.gold)}</b> gemeistert
                {d.reverseLearned > 0 && <> · <b>{fmt(d.reverseLearned)}</b> rückwärts</>}
              </span>
            </div>
            <MasteryBar counts={d.counts} />
          </div>
        ))}
        <MasteryLegend />
        <p className="muted small">Gemeistert = Gold: nächste Wiederholung erst in mind. 2 Monaten.</p>
      </section>

      <section className="panel">
        <h2>Hartnäckige Karten</h2>
        {s.leeches.length === 0 ? (
          <p className="muted small">
            Noch keine. Karten, die du nach dem Lernen {LEECH_LAPSES}× vergessen hast, erscheinen hier – mit deiner Merkhilfe.
          </p>
        ) : (
          <ul className="leech-list">
            {s.leeches.map(l => {
              const card = s.leechCards.get(l.cardId)
              return (
                <li key={l.cardId}>
                  <span className="weak-img">{card?.image && <img src={card.image} alt="" draggable={false} />}</span>
                  <div className="leech-main">
                    <span className="weak-name">{card?.label ?? l.cardId}</span>
                    <span className="muted small">
                      {card?.kind} · {l.lapses}× vergessen · {atLeast(l.level, 'silver') ? `${MASTERY_MEDAL[l.level]} sitzt wieder` : 'übt sich in „Schwächen üben“'}
                    </span>
                    <InlineNote cardId={l.cardId} />
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
