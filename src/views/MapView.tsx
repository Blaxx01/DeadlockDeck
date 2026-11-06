import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { MapCanvas, MapSymbolIcon } from '../components/MapCanvas'
import { getMapData } from '../data/mapSync'
import {
  countKinds, LANE_LABEL, MAP_GROUP_LABEL, MAP_GROUPS, MAP_KIND_ORDER, MAP_KINDS, nearestPoint, type MapGroup, type MapKind, type MapPos,
} from '../map/mapData'

interface Props {
  onBack: () => void
  /** Diese Art gleich hervorheben (z. B. aus dem Map-Quiz) */
  focus?: MapKind
}

/** Standard: alle Ebenen außer Kisten & Statuen */
const DEFAULT_LAYERS: MapGroup[] = ['objectives', 'camps', 'orientation', 'movement']
const ZOOM = 2.5
/** Antippen: so weit (Bildschirm-Pixel) darf das nächste Symbol entfernt sein */
const PICK_PX = 28

export function MapView({ onBack, focus }: Props) {
  const data = useLiveQuery(() => getMapData(), [])
  const [layers, setLayers] = useState<MapGroup[]>(() => {
    const group = focus ? MAP_KINDS[focus].group : undefined
    return group && !DEFAULT_LAYERS.includes(group) ? [...DEFAULT_LAYERS, group] : DEFAULT_LAYERS
  })
  const [selected, setSelected] = useState<MapKind | null>(focus ?? null)
  const [zoom, setZoom] = useState(1)

  const counts = useMemo(() => (data ? countKinds(data) : new Map<MapKind, number>()), [data])
  const visible = useMemo(() => (data ? data.points.filter(p => layers.includes(MAP_KINDS[p.kind].group)) : []), [data, layers])
  // Vergrößern: auf die gewählte Art (Mittelpunkt ihrer Stellen)
  const focusPos = useMemo<MapPos | null>(() => {
    const pts = selected ? visible.filter(p => p.kind === selected) : []
    if (!pts.length) return null
    return { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length }
  }, [visible, selected])

  if (data === undefined) return <div className="center muted">Lade…</div>

  function toggleLayer(group: MapGroup) {
    const on = layers.includes(group)
    setLayers(on ? layers.filter(g => g !== group) : MAP_GROUPS.filter(g => g === group || layers.includes(g)))
    if (on && selected && MAP_KINDS[selected].group === group) setSelected(null)
  }

  function pick(pos: MapPos, widthPx: number) {
    const hit = nearestPoint(visible, pos)
    setSelected(hit && hit.distance * widthPx <= PICK_PX ? hit.point.kind : null)
  }

  const info = selected ? MAP_KINDS[selected] : undefined
  const lanesShown = layers.includes('objectives') || layers.includes('movement')

  return (
    <div className="map-page">
      <header className="home-head">
        <button className="icon-btn" onClick={onBack} aria-label="Zurück">←</button>
        <h1>Map</h1>
        <span className="icon-btn" aria-hidden="true" />
      </header>

      {!data ? (
        <div className="panel">
          <p>Noch keine Map-Daten auf diesem Gerät.</p>
          <p className="muted small">Öffne die App einmal mit Internet – die Map wird mit den übrigen Daten geladen.</p>
        </div>
      ) : (
        <>
          <div className="chips" role="group" aria-label="Ebenen">
            {MAP_GROUPS.map(g => (
              <button key={g} className={`chip toggle${layers.includes(g) ? ' on' : ''}`} aria-pressed={layers.includes(g)} onClick={() => toggleLayer(g)}>
                {MAP_GROUP_LABEL[g]}
              </button>
            ))}
          </div>

          <div className="map-frame">
            <MapCanvas
              data={data}
              points={visible}
              lines={lanesShown}
              highlight={selected}
              onTap={pick}
              zoom={zoom}
              focus={focusPos}
              label="Deadlock-Map mit den gewählten Ebenen"
            />
            <button className="map-zoom" onClick={() => setZoom(z => (z > 1 ? 1 : ZOOM))} aria-pressed={zoom > 1}>
              {zoom > 1 ? '− Ganze Map' : '🔍 Vergrößern'}
            </button>
          </div>

          <div className="panel map-info" aria-live="polite">
            {info && selected ? (
              <>
                <div className="map-info-head">
                  <MapSymbolIcon kind={selected} size={26} />
                  <div>
                    <b>{info.label}</b>
                    <div className="muted small">{MAP_GROUP_LABEL[info.group]} · {counts.get(selected) ?? 0}× auf der Map</div>
                  </div>
                </div>
                {info.info && <p className="small">{info.info}</p>}
              </>
            ) : (
              <p className="muted small">Tippe auf ein Symbol auf der Map oder unten auf einen Eintrag – dann siehst du, was es ist, und alle gleichen leuchten auf.</p>
            )}
          </div>

          <div className="panel map-legend">
            <h2>Legende</h2>
            {layers.length === 0 && <p className="muted small">Keine Ebene gewählt.</p>}
            {MAP_GROUPS.filter(g => layers.includes(g)).map(g => (
              <div key={g} className="legend-group">
                <h3>{MAP_GROUP_LABEL[g]}</h3>
                {g === 'objectives' && data.ziplines.length > 0 && (
                  <p className="legend-lanes small">
                    Lanes:{' '}
                    {data.ziplines.map(z => (
                      <span key={z.lane}><i style={{ background: z.color }} /> {LANE_LABEL[z.lane]}</span>
                    ))}
                  </p>
                )}
                <div className="legend-items">
                  {MAP_KIND_ORDER.filter(k => MAP_KINDS[k].group === g && counts.get(k)).map(k => (
                    <button key={k} className={`legend-item${selected === k ? ' on' : ''}`} aria-pressed={selected === k}
                      onClick={() => setSelected(selected === k ? null : k)}>
                      <MapSymbolIcon kind={k} />
                      <span>{MAP_KINDS[k].label}</span>
                      <span className="muted small">{counts.get(k)}</span>
                    </button>
                  ))}
                </div>
                {g === 'movement' && data.ziplines.length > 0 && <p className="muted small">Ziplines: die Linien in Lane-Farbe.</p>}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
