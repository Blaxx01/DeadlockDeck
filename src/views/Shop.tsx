import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { db } from '../data/db'
import { SLOT_LABEL, type ItemCard, type SlotType } from '../data/model'
import { currentNav, pushNav, type NavState } from '../nav'
import { searchItems, shopTiers } from '../shop/search'
import { ItemDetail } from './ItemDetail'

interface Props {
  onBack: () => void
}

const SLOTS: SlotType[] = ['weapon', 'vitality', 'spirit']

function ShopTile({ card, onOpen }: { card: ItemCard; onOpen: (id: string) => void }) {
  return (
    <button className="shop-tile" onClick={() => onOpen(card.id)}>
      <span className={`tile-icon tile-${card.slot}`}>
        {card.image
          ? <img src={card.image} alt="" loading="lazy" draggable={false} />
          : <span className="tile-fallback">{card.name.slice(0, 2)}</span>}
        {card.isActive && <span className="tile-active">Aktiv</span>}
      </span>
      <span className="tile-name">{card.name}</span>
    </button>
  )
}

export function Shop({ onBack }: Props) {
  const cards = useLiveQuery(() => db.items.toArray(), [])
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
              {results.map(c => <ShopTile key={c.id} card={c} onOpen={openItem} />)}
            </div>
          </section>
        ) : (
          tiers.map(t => (
            <section key={t.tier} className="shop-tier">
              <h2 className="tier-head">
                <span>Tier {t.tier}</span>
                {t.price && <span className="souls">{t.price.toLocaleString('de-DE')} Souls</span>}
              </h2>
              <div className="shop-grid">
                {t.items.map(c => <ShopTile key={c.id} card={c} onOpen={openItem} />)}
              </div>
            </section>
          ))
        )}
      </div>

      {detail && <ItemDetail key={detail.id} card={detail} cards={cards} onBack={closeDetail} onOpen={openItem} />}
    </div>
  )
}
