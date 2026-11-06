import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { db } from '../data/db'
import { SLOT_LABEL, type ItemCard, type SlotType } from '../data/model'
import { countMastery, masteryOf, masteryText, type Mastery, type MasteryCounts } from '../game/mastery'
import { MasteryBar, MasteryLegend, Medal } from '../components/Mastery'
import { isRecentPatch, type PatchRecord } from '../data/patches'
import { PatchBadge } from '../components/PatchNote'
import { currentNav, pushNav, type NavState } from '../nav'
import { searchItems, shopTiers } from '../shop/search'
import { ItemDetail } from './ItemDetail'

interface Props {
  onBack: () => void
}

const SLOTS: SlotType[] = ['weapon', 'vitality', 'spirit']

interface TileProps {
  card: ItemCard
  patch?: PatchRecord
  /** Sammelalbum: Rahmen und Medaille nach Lernstand */
  level: Mastery
  onOpen: (id: string) => void
}

function ShopTile({ card, patch, level, onOpen }: TileProps) {
  return (
    <button className="shop-tile" onClick={() => onOpen(card.id)}>
      <span className={`tile-icon tile-${card.slot} album-${level}`}>
        {card.image
          ? <img src={card.image} alt="" loading="lazy" draggable={false} />
          : <span className="tile-fallback">{card.name.slice(0, 2)}</span>}
        {card.isActive && <span className="tile-active">Aktiv</span>}
        {patch && <PatchBadge patch={patch} short />}
        <Medal level={level} />
      </span>
      <span className="tile-name">{card.name}</span>
    </button>
  )
}

/** Sammelalbum der Kategorie: „12 / 58 gemeistert“ (Gold) mit Balken und Legende */
function AlbumSummary({ slot, counts }: { slot: SlotType; counts: MasteryCounts }) {
  return (
    <section className="album-summary" aria-label={`Sammelalbum ${SLOT_LABEL[slot]}: ${masteryText(counts)}`}>
      <div className="row">
        <h2 className="album-title">Sammelalbum</h2>
        <span><b>{counts.gold}</b>/{counts.total} gemeistert</span>
      </div>
      <MasteryBar counts={counts} />
      <MasteryLegend counts={counts} />
      <p className="muted small">Bronze: gelernt · Silber: nächste Wiederholung in mind. 3 Wochen · Gold: in mind. 2 Monaten</p>
    </section>
  )
}

export function Shop({ onBack }: Props) {
  const cards = useLiveQuery(() => db.items.toArray(), [])
  // Badge: Geändert 14 Tage, Neu 7 Tage
  const patches = useLiveQuery(async () => {
    const now = Date.now()
    return new Map((await db.patches.toArray()).filter(p => isRecentPatch(p, now)).map(p => [p.id, p]))
  }, [])
  // Sammelalbum: Lernstand der Item-Karten
  const reviews = useLiveQuery(async () => new Map((await db.reviews.toArray()).map(r => [r.id, r])), [])
  const [tab, setTab] = useState<SlotType>('weapon')
  const [query, setQuery] = useState('')
  const [detailId, setDetailId] = useState<string | null>(() => currentNav().item ?? null)

  // Detailseiten sind Verlaufseinträge: Zurück (auch Android-Geste) schließt sie
  useEffect(() => {
    const onPop = (e: PopStateEvent) => setDetailId((e.state as NavState | null)?.item ?? null)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const openItem = useCallback((id: string) => {
    pushNav({ view: { name: 'shop' }, item: id })
    setDetailId(id)
  }, [])

  const closeDetail = useCallback(() => {
    if (currentNav().item) window.history.back()
    else setDetailId(null)
  }, [])

  const results = useMemo(() => (cards && query.trim() ? searchItems(cards, query) : null), [cards, query])
  const tiers = useMemo(() => (cards ? shopTiers(cards, tab) : []), [cards, tab])
  const album = useMemo(
    () => (cards && reviews ? countMastery(cards.filter(c => c.slot === tab).map(c => c.id), reviews) : undefined),
    [cards, reviews, tab],
  )
  const levelOf = (id: string) => masteryOf(reviews?.get(id))
  const detail = detailId && cards ? cards.find(c => c.id === detailId) : undefined

  if (!cards) return <div className="center muted">Lade…</div>

  return (
    <div className="shop">
      <div className="shop-sticky" inert={!!detail}>
        <header className="home-head">
          <button className="icon-btn" onClick={onBack} aria-label="Zurück">←</button>
          <h1>Shop</h1>
          <span className="icon-btn" aria-hidden="true" />
        </header>
        <input
          className="shop-search"
          type="search"
          inputMode="search"
          placeholder="Suchen: Name oder Effekt, z. B. Lebensraub"
          value={query}
          onChange={e => setQuery(e.target.value)}
          aria-label="Items suchen"
        />
        {!results && (
          <nav className="shop-tabs" aria-label="Kategorien">
            {SLOTS.map(slot => (
              <button
                key={slot}
                className={`shop-tab slot-${slot}${tab === slot ? ' active' : ''}`}
                aria-pressed={tab === slot}
                onClick={() => {
                  setTab(slot)
                  window.scrollTo({ top: 0 })
                }}
              >
                {SLOT_LABEL[slot]}
              </button>
            ))}
          </nav>
        )}
      </div>

      <div inert={!!detail}>
        {results ? (
          <section className="shop-tier">
            <h2 className="tier-head"><span>{results.length === 1 ? '1 Treffer' : `${results.length} Treffer`}</span></h2>
            {results.length === 0 && <p className="muted">Nichts gefunden. Versuch einen anderen Begriff.</p>}
            <div className="shop-grid">
              {results.map(c => <ShopTile key={c.id} card={c} patch={patches?.get(c.id)} level={levelOf(c.id)} onOpen={openItem} />)}
            </div>
          </section>
        ) : (
          <>
            {album && <AlbumSummary slot={tab} counts={album} />}
            {tiers.map(t => (
              <section key={t.tier} className="shop-tier">
                <h2 className="tier-head">
                  <span>Tier {t.tier}</span>
                  {t.price && <span className="souls">{t.price.toLocaleString('de-DE')} Souls</span>}
                </h2>
                <div className="shop-grid">
                  {t.items.map(c => <ShopTile key={c.id} card={c} patch={patches?.get(c.id)} level={levelOf(c.id)} onOpen={openItem} />)}
                </div>
              </section>
            ))}
          </>
        )}
      </div>

      {detail && <ItemDetail key={detail.id} card={detail} cards={cards} onBack={closeDetail} onOpen={openItem} />}
    </div>
  )
}
