/** Zusatzdaten für Quiz-Runden (Quiz, Überleben) aus der Datenbank */
import { db, type DeckDB } from '../data/db'
import type { ItemCard, QuizScope } from '../data/model'
import { masteryOf } from '../game/mastery'
import type { QuizExtra } from './quiz'

/** Gelernte Karten: im Lernmodus mindestens einmal bewertet (ab Bronze) */
export async function loadLearnedCards(database: DeckDB = db): Promise<Set<string>> {
  const reviews = await database.reviews.toArray()
  return new Set(reviews.filter(r => masteryOf(r) !== 'none').map(r => r.id))
}

/** Counter (Counter-Fragen), Fähigkeiten (Upgrade-Fragen), gelernte Karten (Einstellung `scope`), alle Items (Auflösung) */
export async function loadQuizExtra(allItems: readonly ItemCard[], scope: QuizScope = 'all', database: DeckDB = db): Promise<QuizExtra> {
  const [counters, abilities, known] = await Promise.all([database.counters.toArray(), database.abilities.toArray(), loadLearnedCards(database)])
  return { counters, abilities, known, scope, items: new Map(allItems.map(i => [i.id, i])) }
}
