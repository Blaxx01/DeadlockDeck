import { abilitySlotLabel, type AbilityCard, type HeroCard } from '../data/model'
import { CardImage, SafeHtml, StatList, TimingTiles } from './CardParts'
import { heroGlow } from './heroStyle'

function HeroChip({ name, image, color }: { name: string; image?: string; color?: string }) {
  return (
    <span className="chip hero-chip" style={color ? { borderColor: color } : undefined}>
      {image && <img src={image} alt="" />}
      {name}
    </span>
  )
}

export function AbilityFront({ card }: { card: AbilityCard }) {
  return (
    <div className="front-content">
      <div className="ability-icon">
        <CardImage src={card.image} alt="Welche Fähigkeit ist das?" />
      </div>
      <p className="hint">Welche Fähigkeit ist das? · Tippen zum Umdrehen</p>
    </div>
  )
}

export function AbilityBack({ card }: { card: AbilityCard }) {
  return (
    <div className="back-content">
      <header className="back-head">
        <h2>{card.name}</h2>
        <div className="chips">
          <HeroChip name={card.heroName} image={card.heroImage} color={card.heroColor} />
          <span className={`chip${card.slot === 4 ? ' active' : ''}`}>{abilitySlotLabel(card.slot)}</span>
        </div>
        <SafeHtml html={card.quip} className="quip" />
      </header>

      <TimingTiles timings={card.timings} />

      <section className="sec">
        <h3>Effekt</h3>
        <SafeHtml html={card.html} />
        <StatList stats={card.stats} />
      </section>

      {card.upgrades.length > 0 && (
        <section className="sec upgrades">
          <h3>Upgrades</h3>
          <ol>
            {card.upgrades.map((u, i) => (
              <li key={i}>
                <span className="ap">{u.cost} AP</span>
                <SafeHtml html={u.html} as="span" className="desc" />
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  )
}

export function HeroFront({ card }: { card: HeroCard }) {
  return (
    <div className="front-content">
      <CardImage src={card.image} alt="Welcher Hero ist das?" className="hero-portrait" />
      <p className="hint">Welcher Hero ist das? · Tippen zum Umdrehen</p>
    </div>
  )
}

function Complexity({ value }: { value?: number }) {
  if (!value) return null
  return (
    <span className="chip" title={`Komplexität ${value} von 4`}>
      Komplexität {'●'.repeat(value)}{'○'.repeat(Math.max(0, 4 - value))}
    </span>
  )
}

export function HeroBack({ card }: { card: HeroCard }) {
  return (
    <div className="back-content">
      <header className="back-head">
        <h2 style={card.color ? { color: `color-mix(in srgb, ${card.color} 55%, var(--text))` } : undefined}>{card.name}</h2>
        <div className="chips">
          {card.tags.map(t => <span key={t} className="chip">{t}</span>)}
          {card.gunTag && <span className="chip souls">{card.gunTag}</span>}
          <Complexity value={card.complexity} />
        </div>
        <SafeHtml html={card.role} className="quip" />
      </header>

      {card.playstyle && (
        <section className="sec">
          <h3>Spielstil</h3>
          <SafeHtml html={card.playstyle} />
        </section>
      )}

      <section className="sec">
        <h3>Fähigkeiten</h3>
        <ul className="ability-list">
          {card.abilities.map(a => (
            <li key={a.id}>
              <span className="ability-mini" style={heroGlow(card.color)}>
                {a.image && <img src={a.image} alt="" />}
              </span>
              <span className="ability-name">{a.name}</span>
              <span className="muted small">{abilitySlotLabel(a.slot)}</span>
            </li>
          ))}
        </ul>
      </section>

      {card.stats.length > 0 && (
        <section className="sec">
          <h3>Werte</h3>
          <StatList stats={card.stats} />
        </section>
      )}

      {card.weapon && (
        <section className="sec">
          <h3>Waffe: {card.weapon.name}</h3>
          <StatList stats={card.weapon.stats} />
        </section>
      )}
    </div>
  )
}
