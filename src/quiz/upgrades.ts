/**
 * Fragetyp „Fähigkeiten-Upgrades“: „Was macht das 5-AP-Upgrade von Sleep Dagger?“
 * Falsche Antworten: die beiden anderen Stufen derselben Fähigkeit und ein Upgrade einer anderen Fähigkeit des Heroes.
 */
import type { AbilityCard } from '../data/model'
import { makeOptions, shuffle, type Rng } from './options'
import type { QuizQuestion } from './quiz'

/** Anteil der Fragen zu Fähigkeiten mit gelernter Karte (wenn es welche gibt) */
export const LEARNED_SHARE = 0.75

/** Upgrade-HTML der API → Text für die Antwort */
export function upgradeText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

export function upgradeQuestion(ability: AbilityCard, abilities: readonly AbilityCard[], rng: Rng): QuizQuestion | null {
  const ups = ability.upgrades
  if (ups.length < 3) return null
  const tier = Math.floor(rng() * ups.length)
  const correct = upgradeText(ups[tier].html)
  if (!correct) return null
  const sameTiers = ups.filter((_, i) => i !== tier).map(u => upgradeText(u.html))
  const otherAbilities = shuffle(abilities.filter(a => a.heroId === ability.heroId && a.id !== ability.id), rng)
    .flatMap(a => shuffle(a.upgrades, rng))
    .map(u => upgradeText(u.html))
  // Reihenfolge zählt: erst die anderen Stufen, dann eine andere Fähigkeit des Heroes
  const opts = makeOptions(correct, [...sameTiers, ...otherAbilities].filter(Boolean), rng)
  if (!opts) return null
  return {
    kind: 'upgrade',
    itemId: ability.id,
    cardId: ability.id,
    image: ability.image,
    caption: `Fähigkeit von ${ability.heroName}`,
    prompt: `Was macht das ${ups[tier].cost}-AP-Upgrade von ${ability.name}?`,
    info: `${ability.name}: ${ups.map(u => `${u.cost} AP: ${upgradeText(u.html)}`).join(' · ')}`,
    ...opts,
  }
}

/**
 * Welche Fähigkeiten in Frage kommen: `prefer` = meist (LEARNED_SHARE) eine mit gelernter Karte, sonst irgendeine
 * (Einstellung „Alles“); `only` = nur gelernte; `any` = alle (Auffüllen bei „Gelerntes zuerst“)
 */
export type UpgradePick = 'prefer' | 'only' | 'any'

/** Nächste Upgrade-Frage; jede Fähigkeit höchstens einmal je Runde (`used`). */
export function nextUpgradeQuestion(
  abilities: readonly AbilityCard[],
  learned: ReadonlySet<string>,
  used: ReadonlySet<string>,
  rng: Rng,
  pick: UpgradePick = 'prefer',
): QuizQuestion | null {
  const fresh = abilities.filter(a => !used.has(a.id) && a.upgrades.length >= 3)
  const known = fresh.filter(a => learned.has(a.id))
  const pool = pick === 'only' ? known : pick === 'any' ? fresh : known.length > 0 && rng() < LEARNED_SHARE ? known : fresh
  for (const ability of shuffle(pool, rng)) {
    const question = upgradeQuestion(ability, abilities, rng)
    if (question) return question
  }
  return null
}
