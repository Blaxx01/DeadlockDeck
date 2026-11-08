import { useState } from 'react'
import { chooseHero, HERO_MISSION_ID, type DailyStatus, type HeroChoice } from '../game/missions'

interface Props {
  daily: DailyStatus
  /** Session mit seinen Karten */
  onLearn: () => void
  /** Build-Quiz mit ihm */
  onBuild: (heroId: number) => void
}

function hint(choice: HeroChoice): string {
  if (choice.mode === 'build') return 'Build-Quiz'
  const cards = `${choice.cards} ${choice.cards === 1 ? 'Karte' : 'Karten'}`
  return choice.mode === 'learn' ? `${cards} neu` : `${cards} wiederholen`
}

/** Held des Tages im Feld „Heute“: drei Vorschläge zur Wahl, danach der Held mit seiner Mission */
export function HeroOfDay({ daily, onLearn, onBuild }: Props) {
  const [picking, setPicking] = useState(false)
  /** Gerade gewählt – die Auswahl bleibt offen, bis der neue Held in den Daten steht (kein Aufblitzen des alten) */
  const [chosen, setChosen] = useState<string | null>(null)
  const { hero, heroOffer } = daily
  const mission = daily.missions.find(m => m.def.id === HERO_MISSION_ID)
  if (!mission) return null

  function choose(id: string) {
    setChosen(id)
    void chooseHero(id).then(ok => {
      if (!ok) {
        setChosen(null)
        setPicking(false)
      }
    })
  }

  const settled = !!chosen && hero?.id === chosen
  if ((!hero || (picking && !settled)) && heroOffer?.length) {
    return (
      <div className="hero-day pick" role="group" aria-label="Held des Tages wählen">
        <div className="hero-day-head">
          <b>Held des Tages</b>
          <span className="muted small">{hero ? `Statt ${hero.name}:` : 'Wer greift heute mit dir an?'}</span>
        </div>
        <div className="hero-choices">
          {heroOffer.map(c => (
            <button key={c.id} className={`hero-choice${(chosen ?? hero?.id) === c.id ? ' on' : ''}`} aria-pressed={(chosen ?? hero?.id) === c.id}
              disabled={!!chosen} onClick={() => choose(c.id)}>
              <span className="hero-portrait">{c.image && <img src={c.image} alt="" draggable={false} />}</span>
              <span className="hero-choice-name">{c.name}</span>
              <span className="muted small">{hint(c)}</span>
            </button>
          ))}
        </div>
        {hero && !chosen && <button className="link small" onClick={() => setPicking(false)}>Doch {hero.name}</button>}
      </div>
    )
  }
  if (!hero) return null

  return (
    <div className={`hero-day${mission.done ? ' finished' : ''}`}>
      <span className="hero-portrait">{hero.image && <img src={hero.image} alt="" draggable={false} />}</span>
      {/* Was zu tun ist, steht gleich darunter in der Missionsliste */}
      <span className="hero-day-text">
        <b>{hero.name}</b>
        <span className="muted small">
          {mission.done ? 'Mission geschafft ✓' : 'greift mit dir an'}
          {hero.canChange && <> · <button className="link small" onClick={() => { setChosen(null); setPicking(true) }}>Wechseln</button></>}
        </span>
      </span>
      {!mission.done && (
        <button className="primary hero-go" onClick={() => (hero.mode === 'build' ? onBuild(hero.heroId) : onLearn())}>
          {hero.mode === 'build' ? 'Build-Quiz' : 'Angreifen'}
        </button>
      )}
    </div>
  )
}
