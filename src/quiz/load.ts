/** Zusatzdaten für Quiz-Runden (Quiz, Überleben) aus der Datenbank */
import { db } from '../data/db'
import type { ItemCard } from '../data/model'
import { masteryOf } from '../game/mastery'
import type { QuizExtra } from './quiz'

/** Counter (Counter-Fragen), Fähigkeiten und gelernte Fähigkeiten (Upgrade-Fragen), alle Items (Auflösung) */
export async function loadQuizExtra(allItems: readonly ItemCard[]): Promise<QuizExtra> {
  const [counters, abilities] = await Promise.all([db.counters.toArray(), db.abilities.toArray()])
  const reviews = await db.reviews.bulkGet(abilities.map(a => a.id))
  const learnedAbilities = new Set(reviews.filter(r => r !== undefined && masteryOf(r) !== 'none').map(r => r!.id))
  return { counters, abilities, learnedAbilities, items: new Map(allItems.map(i => [i.id, i])) }
}
