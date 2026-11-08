import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { formatDuration } from '../builds/buildQuiz'
import { Medal, Stars } from '../components/Mastery'
import { db, type ReviewRecord } from '../data/db'
import { allHeroMastery, counterCardId, heroCardIds, MAX_STARS, STAR_IDS, STAR_LABEL, type HeroMastery, type StarId } from '../game/heroMastery'
import { getLaneSummary } from '../game/laneAttack'
import { STAR_SOULS } from '../game/milestones'
import { atLeast, MASTERY_LABEL, MASTERY_MEDAL, type Mastery } from '../game/mastery'
import { currentNav, pushNav, type NavState } from '../nav'
import { requestLearn } from '../srs/srs'

interface Props {
  onBack: () => void
}

function level(m: Mastery): string {
  return m === 'none' ? 'Neu' : `${MASTERY_MEDAL[m]} ${MASTERY_LABEL[m]}`
}

/** Stand eines Sterns in einer Zeile, z. B. „🥉 Bronze“ oder „2 von 4 mind. Silber“ */
function starStatus(id: StarId, m: HeroMastery): ReactNode {
  switch (id) {
    case 'hero':
      return level(m.heroLevel)
    case 'abilities': {
      const done = m.abilityLevels.filter(a => atLeast(a.level, 'silver')).length
      return (
        <>
          {done} von {m.abilityLevels.length} mind. Silber
          <span className="star-abilities">
            {m.abilityLevels.map(a => (
              <span key={a.id} className={`star-ability album-${a.level}`} title={`${a.name}: ${MASTERY_LABEL[a.level]}`}>
                {a.image && <img src={a.image} alt={a.name} draggable={false} />}
                <Medal level={a.level} />
              </span>
            ))}
          </span>
        </>
      )
    }
    case 'counter':
      return m.counterLevel ? level(m.counterLevel) : 'Noch keine Counter-Daten'
    case 'build':
      return m.buildBest
        ? `Bestwert: ${m.buildBest.errors} Fehler · ${formatDuration(m.buildBest.ms)}`
        : 'Noch nicht gespielt'
    case 'guess':
      return m.guessClean ? 'Geschafft' : 'Noch nicht'
  }
}

/** Hero-Seite: die 5 Sterne mit Stand, neue Karten vormerken */
function HeroDetail({ mastery, onBack }: { mastery: HeroMastery; onBack: () => void }) {
  const { hero, stars } = mastery
  const pageRef = useRef<HTMLDivElement>(null)
  // Fokus in die Seite: Tasten wirken hier und nicht auf der Kachel darunter
  useEffect(() => { pageRef.current?.focus({ preventScroll: true }) }, [hero.id])
  // Noch nie gelernte Karten des Heroes – vormerken bringt sie in die nächste Session ihres Decks
  const unlearned = [
    ...(mastery.heroLevel === 'none' ? [hero.id] : []),
    ...mastery.abilityLevels.filter(a => a.level === 'none').map(a => a.id),
    ...(mastery.counterLevel === 'none' ? [counterCardId(hero)] : []),
  ]
  const requested = useLiveQuery(
    async () => new Set((await db.reviews.bulkGet(heroCardIds([hero]))).filter((r): r is ReviewRecord => !!r?.requested).map(r => r.id)),
    [hero],
  )
  const toRequest = unlearned.filter(id => !requested?.has(id))
  const pending = unlearned.length - toRequest.length
  // Lane-Angriff: Siege mit diesem Helden des Tages
  const laneWins = useLiveQuery(async () => (await getLaneSummary()).byHero[hero.id] ?? 0, [hero.id])

  async function learnFresh() {
    for (const id of toRequest) await requestLearn(id)
  }

  return (
    <div className="detail-page" role="dialog" aria-label={hero.name} tabIndex={-1} ref={pageRef}>
      <div className="detail-inner">
        <header className="home-head">
          <button className="icon-btn" onClick={onBack} aria-label="Zurück">←</button>
          <span className="muted small">Heroes</span>
          <span className="icon-btn" aria-hidden="true" />
        </header>

        <div className="hm-head" style={{ '--hero-color': hero.color ?? 'var(--accent)' } as CSSProperties}>
          <span className="hm-portrait">{hero.image && <img src={hero.image} alt="" draggable={false} />}</span>
          <div className="hm-title">
            <h1>{hero.name}</h1>
            <Stars count={stars.length} max={MAX_STARS} />
            <span className="muted small">{stars.length} von {MAX_STARS} Sternen</span>
            {!!laneWins && <span className="small hm-lane">🏆 {laneWins} {laneWins === 1 ? 'Sieg' : 'Siege'} als Held des Tages</span>}
          </div>
        </div>

        <ul className="star-list">
          {STAR_IDS.map(id => {
            const done = stars.includes(id)
            return (
              <li key={id} className={done ? 'done' : undefined}>
                <span className="star-mark" aria-hidden="true">{done ? '★' : '☆'}</span>
                <span className="star-text">
                  <span className="star-label">{STAR_LABEL[id]}<span className="sr-only">{done ? ' – geschafft' : ' – offen'}</span></span>
                  <span className="muted small">{starStatus(id, mastery)}</span>
                </span>
              </li>
            )
          })}
        </ul>

        {requested && toRequest.length > 0 && (
          <button onClick={() => void learnFresh()}>Neue Karten von {hero.name} lernen ({toRequest.length})</button>
        )}
        {requested && toRequest.length === 0 && pending > 0 && (
          <p className="good small">
            {pending === 1 ? '1 Karte vorgemerkt – sie kommt' : `${pending} Karten vorgemerkt – sie kommen`} in der nächsten
            Session ihres Decks dran.
          </p>
        )}

        <p className="muted small">
          Silber heißt: Die nächste Wiederholung ist erst in mindestens 3 Wochen fällig – dafür braucht eine Karte ein paar
          richtige Wiederholungen über mehrere Wochen. Vergisst du eine Karte, ist der Stern weg, bis sie wieder sitzt.
          Jeder neue Stern bringt einmalig +{STAR_SOULS} ◆.
        </p>
      </div>
    </div>
  )
}

export function Heroes({ onBack }: Props) {
  const list = useLiveQuery(() => allHeroMastery(), [])
  const [openId, setOpenId] = useState<string | null>(() => currentNav().hero ?? null)

  // Hero-Seiten sind Verlaufseinträge: Zurück (auch die Android-Geste) schließt sie
  useEffect(() => {
    const onPop = (e: PopStateEvent) => setOpenId((e.state as NavState | null)?.hero ?? null)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  const open = useCallback((id: string) => {
    pushNav({ view: { name: 'heroes' }, hero: id })
    setOpenId(id)
  }, [])
  const close = useCallback(() => {
    if (currentNav().hero) window.history.back()
    else setOpenId(null)
  }, [])
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      if (openId) close()
      else onBack()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openId, close, onBack])

  if (!list) return <div className="center muted">Lade…</div>
  const total = list.reduce((sum, m) => sum + m.stars.length, 0)
  const complete = list.filter(m => m.stars.length === MAX_STARS).length
  const detail = openId ? list.find(m => m.hero.id === openId) : undefined

  return (
    <div className="heroes-page">
      <div inert={!!detail}>
        <header className="home-head">
          <button className="icon-btn" onClick={onBack} aria-label="Zurück">←</button>
          <h1>Heroes</h1>
          <span className="icon-btn" aria-hidden="true" />
        </header>
        {list.length === 0 ? (
          <div className="panel"><p>Noch keine Hero-Daten – öffne die App einmal mit Internet.</p></div>
        ) : (
          <>
            <div className="panel">
              <div className="row">
                <h2>Meisterschaft</h2>
                <span><span className="star-on">★</span> <b>{total}</b>/{list.length * MAX_STARS}</span>
              </div>
              <p className="muted small">
                Je Hero 5 Sterne: Hero-, Fähigkeiten- und Counter-Karte sitzen (mind. Silber), Build-Quiz (Typisch) ohne
                Fehler, Hero erraten ohne Hilfe.{complete > 0 && ` ${complete} ${complete === 1 ? 'Hero hat' : 'Heroes haben'} alle 5.`}
              </p>
            </div>
            <div className="mastery-grid">
              {list.map(m => (
                <button
                  key={m.hero.id}
                  className={`hero-tile mastery-tile${m.stars.length === MAX_STARS ? ' complete' : ''}`}
                  onClick={() => open(m.hero.id)}
                  aria-label={`${m.hero.name}: ${m.stars.length} von ${MAX_STARS} Sternen`}
                >
                  <span className="hero-tile-img">{m.hero.smallImage && <img src={m.hero.smallImage} alt="" draggable={false} />}</span>
                  <span className="hero-tile-name">{m.hero.name}</span>
                  <Stars count={m.stars.length} max={MAX_STARS} />
                </button>
              ))}
            </div>
          </>
        )}
      </div>
      {detail && <HeroDetail key={detail.hero.id} mastery={detail} onBack={close} />}
    </div>
  )
}
