/**
 * Counter-Daten aus der Statistik der Deadlock-API: Welche Items kaufen Spieler (ab Orakel)
 * gegen einen bestimmten Hero deutlich öfter als sonst?
 *
 * Kauf-Faktor = Anteil des Items an allen Käufen gegen Hero X ÷ sein Anteil an allen Käufen.
 * Bewusst nicht die Gewinnrate: Counter-Items kauft man oft erst, wenn man schon hinten liegt –
 * Knockdown gegen Vindicta hätte z. B. eine negative Gewinnrate.
 */
import type { CounterCard, CounterItem, HeroCard, ItemCard } from './model'
import type { PatchRecord } from './patches'

/** Durchschnittlicher Rang beider Teams ab 81 = Orakel 1 */
export const COUNTER_MIN_BADGE = 81
export const COUNTER_MIN_RANK = 'Orakel'
/** Ab diesem Kauf-Faktor ist ein Item ein klarer Counter */
export const CLEAR_COUNTER = 1.3
/** Bis zu diesem Faktor ist ein Item gegen den Hero kein Counter (falsche Antworten im Quiz) */
export const NO_COUNTER = 1.0
/** Mindestanzahl Käufe eines Items gegen einen Hero, damit sein Faktor zählt */
export const MIN_PURCHASES = 2000
export const TOP_COUNTERS = 3

/** Teilmenge einer Zeile von /v1/analytics/item-stats */
export interface ApiItemStat {
  item_id: number
  /** Bei `bucket=enemy_hero`: Hero-ID des Gegners */
  bucket: number
  wins: number
  losses: number
  /** Anzahl Käufe (Spieler × Match) */
  matches: number
  /** ⌀ Kaufzeit in Sekunden */
  avg_buy_time_s?: number
}

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * Baut die Counter-Karten: je Hero die Top 3 nach Kauf-Faktor und alle Faktoren (fürs Quiz).
 * Nur Items aus dem Shop mit mindestens MIN_PURCHASES Käufen gegen den Hero; Heroes mit
 * weniger als 3 solchen Items (zu wenig Daten) bekommen keine Karte.
 */
export function computeCounters(
  byEnemy: readonly ApiItemStat[],
  base: readonly ApiItemStat[],
  items: readonly ItemCard[],
  heroes: readonly HeroCard[],
  now: number,
): CounterCard[] {
  const itemByApiId = new Map(items.filter(i => typeof i.apiId === 'number').map(i => [i.apiId, i]))
  const baseMatches = new Map<number, number>()
  let totalAll = 0
  for (const r of base) {
    if (!itemByApiId.has(r.item_id)) continue
    baseMatches.set(r.item_id, (baseMatches.get(r.item_id) ?? 0) + r.matches)
    totalAll += r.matches
  }
  if (totalAll === 0) return []

  const rowsByHero = new Map<number, ApiItemStat[]>()
  for (const r of byEnemy) {
    if (!itemByApiId.has(r.item_id)) continue
    const rows = rowsByHero.get(r.bucket) ?? []
    rows.push(r)
    rowsByHero.set(r.bucket, rows)
  }

  const cards: CounterCard[] = []
  for (const hero of heroes) {
    const rows = rowsByHero.get(hero.heroId) ?? []
    const totalHero = rows.reduce((sum, r) => sum + r.matches, 0)
    if (totalHero === 0) continue
    const factors: Record<string, number> = {}
    const ranked: CounterItem[] = []
    for (const r of rows) {
      const baseCount = baseMatches.get(r.item_id)
      if (!baseCount || r.matches < MIN_PURCHASES) continue
      const item = itemByApiId.get(r.item_id)!
      const factor = round2((r.matches / totalHero) / (baseCount / totalAll))
      factors[item.id] = factor
      ranked.push({ itemId: item.id, factor })
    }
    if (ranked.length < TOP_COUNTERS) continue
    ranked.sort((a, b) => b.factor - a.factor || a.itemId.localeCompare(b.itemId))
    cards.push({
      id: `counter:${hero.className}`,
      heroId: hero.heroId,
      heroName: hero.name,
      image: hero.image,
      smallImage: hero.smallImage,
      color: hero.color,
      order: 0,
      top: ranked.slice(0, TOP_COUNTERS),
      factors,
      updatedAt: now,
    })
  }
  // Klarste Counter zuerst
  cards.sort((a, b) => b.top[0].factor - a.top[0].factor || a.heroName.localeCompare(b.heroName))
  cards.forEach((c, i) => { c.order = i })
  return cards
}

/** „2,1×“ */
export function formatFactor(factor: number): string {
  return `${factor.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}×`
}

export function isClearCounter(factor: number | undefined): boolean {
  return factor !== undefined && factor >= CLEAR_COUNTER
}

/**
 * Wechselt das wichtigste Item eines Heroes und ist das neue ein klarer Counter, gibt es einen
 * Änderungs-Eintrag („vorher → nachher“). Andere Verschiebungen in den Top 3 zählen nicht –
 * die Plätze 2–3 schwanken von Monat zu Monat stark.
 */
export function detectCounterChanges(
  oldCards: readonly CounterCard[],
  newCards: readonly CounterCard[],
  now: number,
  nameOf: (itemId: string) => string,
): PatchRecord[] {
  const old = new Map(oldCards.map(c => [c.id, c]))
  const records: PatchRecord[] = []
  for (const card of newCards) {
    const before = old.get(card.id)?.top[0]
    const after = card.top[0]
    if (!before || !after || before.itemId === after.itemId || !isClearCounter(after.factor)) continue
    records.push({
      id: card.id,
      detectedAt: now,
      kind: 'changed',
      changes: [{
        label: 'Wichtigstes Item',
        before: `${nameOf(before.itemId)} ${formatFactor(before.factor)}`,
        after: `${nameOf(after.itemId)} ${formatFactor(after.factor)}`,
      }],
    })
  }
  return records
}

function stripHtml(html: string): string {
  return html.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').replace(/\s+([.,!?:;])/g, '$1').trim()
}

const SECTION_ORDER = ['active', 'passive', 'innate']

/** Erster Satz des Item-Effekts (Aktiv vor Passiv vor Boni) – zeigt, warum ein Counter hilft. */
export function effectSummary(item: ItemCard, max = 140): string | undefined {
  const text = [...item.sections]
    .sort((a, b) => SECTION_ORDER.indexOf(a.type) - SECTION_ORDER.indexOf(b.type))
    .map(s => (s.html ? stripHtml(s.html) : ''))
    .find(t => t.length > 0)
  if (!text) return undefined
  // „z. B.“ & Co. sind kein Satzende
  const guarded = text.replace(/\b([zdu])\. ([BhaA])\./g, '$1․ $2․')
  const first = guarded.split(/(?<=[.!?])\s+(?=[A-ZÄÖÜ])/)[0].replace(/․/g, '.')
  if (first.length <= max) return first
  const cut = first.lastIndexOf(' ', max - 2)
  return `${first.slice(0, cut > 0 ? cut : max - 2)} …`
}
