import { useLayoutEffect, useRef, type MouseEvent } from 'react'
import type { MapData, MapKind, MapPoint, MapPos } from '../map/mapData'
import { MAP_SYMBOLS, symbolColor } from '../map/mapSymbols'

/** Karten-Einheiten des Overlays (0–1000) */
const U = 1000

interface Props {
  data: MapData
  /** Gezeigte Objekte */
  points: readonly MapPoint[]
  /** Lanes (Ziplines in Lane-Farbe) zeigen */
  lines?: boolean
  /** Hervorgehobene Art: größer, mit Ring; Teleporter/Sprungpads mit Linie zum Ziel */
  highlight?: MapKind | null
  /** Quiz „Was ist hier?“: markierte Stelle */
  spot?: MapPos | null
  /** Quiz „Wo ist …?“: der eigene Tipp */
  tap?: { pos: MapPos; correct: boolean } | null
  /** Tipp auf die Karte: relative Position und Breite der Karte in Pixeln (für Abstände auf dem Bildschirm) */
  onTap?: (pos: MapPos, widthPx: number) => void
  /** Vergrößerung (1 = ganze Karte); größer: im Rahmen verschiebbar */
  zoom?: number
  /** Beim Vergrößern hierhin scrollen (sonst Mitte) */
  focus?: MapPos | null
  label?: string
}

function Symbol({ point, strong }: { point: MapPoint; strong: boolean }) {
  const sym = MAP_SYMBOLS[point.kind]
  const s = sym.size * (strong ? 1.35 : 1)
  const x = point.x * U
  const y = point.y * U
  const color = symbolColor(point.kind, point.lane)
  const stroke = { stroke: '#120f0b', strokeWidth: s > 6 ? 2.5 : 1 }
  let shape
  switch (sym.shape) {
    case 'circle': shape = <circle cx={x} cy={y} r={s} fill={color} {...stroke} />; break
    case 'ring': shape = <circle cx={x} cy={y} r={s} fill="none" stroke={color} strokeWidth={s * 0.45} />; break
    case 'square': shape = <rect x={x - s} y={y - s} width={2 * s} height={2 * s} rx={s * 0.25} fill={color} {...stroke} />; break
    case 'diamond': shape = <polygon points={`${x},${y - s} ${x + s},${y} ${x},${y + s} ${x - s},${y}`} fill={color} {...stroke} />; break
    case 'triangle': shape = <polygon points={`${x},${y - s} ${x + s},${y + s * 0.8} ${x - s},${y + s * 0.8}`} fill={color} {...stroke} />; break
    case 'bar': shape = <rect x={x - s * 0.3} y={y - s} width={s * 0.6} height={2 * s} fill={color} {...stroke} />; break
  }
  return (
    <g className={strong ? 'map-sym strong' : 'map-sym'}>
      {strong && <circle cx={x} cy={y} r={s + 9} className="map-sym-halo" />}
      {shape}
      {sym.glyph && <text x={x} y={y} dy="0.36em" textAnchor="middle" fontSize={s * 1.15} className="map-glyph">{sym.glyph}</text>}
    </g>
  )
}

/** Symbol einer Art als kleines Bild (Legende, Antworten) */
export function MapSymbolIcon({ kind, lane, size = 22 }: { kind: MapKind; lane?: MapPoint['lane']; size?: number }) {
  const s = MAP_SYMBOLS[kind].size
  const half = Math.max(s, 9) + 4
  return (
    <svg className="map-icon" width={size} height={size} viewBox={`${-half} ${-half} ${2 * half} ${2 * half}`} aria-hidden="true">
      <Symbol point={{ kind, x: 0, y: 0, lane }} strong={false} />
    </svg>
  )
}

/** Minimap mit Lanes und Objekten; Antippen liefert die Position, Vergrößern macht sie verschiebbar */
export function MapCanvas({ data, points, lines = true, highlight, spot, tap, onTap, zoom = 1, focus, label = 'Deadlock-Map' }: Props) {
  const viewport = useRef<HTMLDivElement>(null)

  // Beim Vergrößern auf die Mitte bzw. das gewählte Objekt scrollen
  useLayoutEffect(() => {
    const el = viewport.current
    if (!el) return
    const target = focus ?? { x: 0.5, y: 0.5 }
    el.scrollLeft = target.x * el.scrollWidth - el.clientWidth / 2
    el.scrollTop = target.y * el.scrollHeight - el.clientHeight / 2
  }, [zoom, focus])

  function click(e: MouseEvent<SVGSVGElement>) {
    if (!onTap) return
    const box = e.currentTarget.getBoundingClientRect()
    onTap({ x: (e.clientX - box.left) / box.width, y: (e.clientY - box.top) / box.height }, box.width)
  }

  // Hervorgehobene zuletzt (oben), Ziele von Teleportern/Sprungpads als Linie
  const ordered = highlight ? [...points.filter(p => p.kind !== highlight), ...points.filter(p => p.kind === highlight)] : points
  const routes = highlight ? points.filter(p => p.kind === highlight && p.to) : []
  return (
    <div className={`map-viewport${zoom > 1 ? ' zoomed' : ''}`} ref={viewport}>
      <div className="map-stage" style={{ width: `${zoom * 100}%` }}>
        <img className="map-image" src={data.image} alt="" draggable={false} />
        <svg viewBox={`0 0 ${U} ${U}`} className={`map-overlay${onTap ? ' tappable' : ''}`} onClick={click} role="img" aria-label={label}>
          {lines && data.ziplines.map(z => (
            <polyline key={z.lane + z.color} points={z.points.map(p => `${p.x * U},${p.y * U}`).join(' ')} stroke={z.color} className="map-lane" />
          ))}
          {routes.map((p, i) => (
            <line key={i} x1={p.x * U} y1={p.y * U} x2={p.to!.x * U} y2={p.to!.y * U} className="map-route" />
          ))}
          {ordered.map((p, i) => <Symbol key={`${p.kind}-${i}`} point={p} strong={p.kind === highlight} />)}
          {spot && (
            <g className="map-spot">
              <circle cx={spot.x * U} cy={spot.y * U} r={26} />
              <circle cx={spot.x * U} cy={spot.y * U} r={6} className="map-spot-core" />
            </g>
          )}
          {tap && (
            <g className={`map-tap ${tap.correct ? 'good' : 'bad'}`}>
              <circle cx={tap.pos.x * U} cy={tap.pos.y * U} r={14} />
              <text x={tap.pos.x * U} y={tap.pos.y * U} dy="0.36em" textAnchor="middle" fontSize={18}>{tap.correct ? '✓' : '✕'}</text>
            </g>
          )}
        </svg>
      </div>
    </div>
  )
}
