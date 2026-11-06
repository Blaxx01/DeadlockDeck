import { SLOT_LABEL, type ItemCard } from '../data/model'
import type { QuizQuestion } from './quiz'

/** „Fleetfoot · Weapon · Tier 2 · 1.600 Souls · Cooldown 30s“ */
export function itemInfo(card: ItemCard | undefined): string {
  if (!card) return ''
  const parts = [card.name, SLOT_LABEL[card.slot], `Tier ${card.tier}`]
  if (card.cost) parts.push(`${card.cost.toLocaleString('de-DE')} Souls`)
  const cd = card.timings.find(t => t.kind === 'cooldown')
  if (cd) parts.push(`Cooldown ${cd.value}`)
  return parts.join(' · ')
}

/** HTML → kurzer Text (Fehlerliste) */
export function plainText(html: string, max = 90): string {
  const text = html.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/** Frage in einer Zeile (Fehlerliste): Beschreibung als Zitat, Effekt-Fragen mit dem Wert */
export function questionLine(q: QuizQuestion): string {
  if (q.kind === 'description' && q.html) return `„${plainText(q.html)}“`
  if (q.kind === 'effect' && q.subjectText) return `„${q.subjectText.replace(/\u00ad/g, '')}“ – ${q.prompt}`
  return q.prompt
}
