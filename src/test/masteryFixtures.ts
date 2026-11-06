// Testdaten für Meisterschaft, Hero-Sterne und Meilensteine
import { createEmptyCard, State } from 'ts-fsrs'
import type { ReviewRecord } from '../data/db'
import type { AbilityCard, CounterCard, HeroCard } from '../data/model'
import { hero } from './counterFixtures'

/** Lernstand mit gegebenem Abstand bis zur nächsten Wiederholung (Tage) */
export function review(id: string, scheduledDays: number, state: State = State.Review): ReviewRecord {
  return { ...createEmptyCard(new Date(2026, 10, 1)), id, state, scheduled_days: scheduledDays, stability: scheduledDays, reps: 3 }
}

/** Hero mit 4 Fähigkeiten (Karten-IDs ability:<hero>_1 … _4) */
export function fullHero(heroId: number, name: string): HeroCard {
  const h = hero(heroId, name)
  return { ...h, abilities: [1, 2, 3, 4].map(slot => ({ id: `ability:${h.className}_${slot}`, name: `${name} ${slot}`, slot })) }
}

export function abilityCards(h: HeroCard): AbilityCard[] {
  return h.abilities.map(a => ({
    id: a.id, className: a.id.slice('ability:'.length), name: a.name, heroId: h.heroId, heroName: h.name, slot: a.slot,
    order: a.slot, timings: [], stats: [], upgrades: [], fingerprint: '',
  }))
}

export function counterCard(h: HeroCard): CounterCard {
  return { id: `counter:${h.className}`, heroId: h.heroId, heroName: h.name, order: 0, top: [], factors: {}, updatedAt: 0 }
}
