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
  const { hero, heroOffer } = daily
  const mission = daily.missions.find(m => m.def.id === HERO_MISSION_ID)
  if (!mission) return null

  if ((!hero || picking) && heroOffer?.length) {
    return (
      <div className="hero-day pick" role="group" aria-label="Held des Tages wählen">
        <div className="hero-day-head">
          <b>Held des Tages</b>
          <span className="muted small">{hero ? `Statt ${hero.name}:` : 'Wer greift heute mit dir an?'}</span>
        </div>
        <div className="hero-choices">
          {heroOffer.map(c => (
            <button key={c.id} className={`hero-choice${hero?.id === c.id ? ' on' : ''}`} aria-pressed={hero?.id === c.id}
              onClick={() => void chooseHero(c.id).then(() => setPicking(false))}>
              <span className="hero-portrait">{c.image && <img src={c.image} alt="" draggable={false} />}</span>
              <span className="hero-choice-name">{c.name}</span>
              <span className="muted small">{hint(c)}</span>
            </button>
          ))}
        </div>
        {hero && <button className="link small" onClick={() => setPicking(false)}>Doch {hero.name}</button>}
      </div>
    )
  }
  if (!hero) return null

  return (
    <div className={`hero-day${mission.done ? ' done' : ''}`}>
      <span className="hero-portrait">{hero.image && <img src={hero.image} alt="" draggable={false} />}</span>
      <span className="hero-day-text">
        <span><b>{hero.name}</b> <span className="muted small">greift mit dir an</span></span>
        <span className="muted small">
          {mission.done ? 'Seine Mission ist geschafft ✓' : mission.def.title}
          {hero.canChange && <> · <button className="link small" onClick={() => setPicking(true)}>Wechseln</button></>}
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
