import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, type CSSProperties } from 'react'
import { MAP_UNITS, MapCanvas, MapSymbolIcon } from '../components/MapCanvas'
import { getMapData } from '../data/mapSync'
import {
  getLaneSummary, hpPercent, LANE_NAME, LANE_TARGETS, laneTargetPoints, PATRON_LABEL, targetLabel, type LaneState,
} from '../game/laneAttack'
import { dailyStatus, type MissionStatus } from '../game/missions'
import type { MapData, MapPoint } from '../map/mapData'
import { LANE_COLOR } from '../map/mapSymbols'

interface Props {
  onBack: () => void
  onStats: () => void
}

const fmt = (n: number) => n.toLocaleString('de-DE')
const plural = (n: number, one: string, many: string) => `${fmt(n)} ${n === 1 ? one : many}`

/** Lebensring um noch stehende Ziele, ✕ über zerstörten (in Karten-Einheiten) */
function TargetMarks({ lane, points }: { lane: LaneState; points: Partial<Record<string, MapPoint>> }) {
  return (
    <>
      {lane.targets.map(t => {
        const p = points[t.kind]
        if (!p) return null
        const x = p.x * MAP_UNITS
        const y = p.y * MAP_UNITS
        if (t.hp <= 0) {
          const r = 17
          return (
            <g key={t.kind} className="lane-map-x" aria-hidden="true">
              <path d={`M${x - r} ${y - r}L${x + r} ${y + r}M${x - r} ${y + r}L${x + r} ${y - r}`} className="under" />
              <path d={`M${x - r} ${y - r}L${x + r} ${y + r}M${x - r} ${y + r}L${x + r} ${y - r}`} />
            </g>
          )
        }
        const r = t.kind === 'patron' ? 38 : 32
        const c = 2 * Math.PI * r
        return (
          <g key={t.kind} className="lane-map-ring" aria-hidden="true">
            <circle cx={x} cy={y} r={r} className="track" />
            <circle cx={x} cy={y} r={r} className="hp" strokeDasharray={`${(c * hpPercent(t.hp)) / 100} ${c}`}
              transform={`rotate(-90 ${x} ${y})`} />
          </g>
        )
      })}
    </>
  )
}

function LaneMap({ map, lane }: { map: MapData; lane: LaneState }) {
  const points = laneTargetPoints(map, lane.lane)
  const shown = LANE_TARGETS.map(k => points[k]).filter((p): p is MapPoint => !!p)
  const destroyed = lane.targets.filter(t => t.hp <= 0).map(t => points[t.kind]).filter((p): p is MapPoint => !!p)
  const front = lane.won ? null : lane.targets[lane.front].kind
  // nur die Lane des Tages
  const data = { ...map, ziplines: map.ziplines.filter(z => z.lane === lane.lane) }
  return (
    <div className="map-frame">
      <MapCanvas data={data} points={shown} highlight={front} dimmed={destroyed}
        label={`Deadlock-Map: ${LANE_NAME[lane.lane]} mit Guardian, Walker und Patron der gegnerischen Basis`}>
        <TargetMarks lane={lane} points={points} />
      </MapCanvas>
    </div>
  )
}

function MissionList({ missions }: { missions: readonly MissionStatus[] }) {
  return (
    <ul className="missions">
      {missions.map(m => (
        <li key={m.def.id} className={m.done ? 'done' : undefined}>
          <span className="mission-check" aria-hidden="true">{m.done ? '✓' : '○'}</span>
          <span className="mission-title">{m.def.title}</span>
          <span className="mission-progress muted small">{m.done ? '' : `${fmt(m.progress)} / ${fmt(m.def.target)}`}</span>
        </li>
      ))}
    </ul>
  )
}

/** Lane-Angriff des Tages: Map mit Lane und Zielen, Leben je Ziel, Missionen, Bilanz */
export function LaneView({ onBack, onStats }: Props) {
  const s = useLiveQuery(async () => {
    const [daily, map, summary] = await Promise.all([dailyStatus(), getMapData(), getLaneSummary()])
    return { daily, map, summary }
  }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onBack() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onBack])

  if (!s) return <div className="center muted">Lade…</div>
  const lane = s.daily.lane
  const { summary } = s

  return (
    <div className="lane-page" style={lane ? { '--lane': LANE_COLOR[lane.lane] } as CSSProperties : undefined}>
      <header className="home-head">
        <button className="icon-btn" onClick={onBack} aria-label="Zurück">←</button>
        <h1>Lane-Angriff</h1>
        <span className="icon-btn" aria-hidden="true" />
      </header>

      {!lane ? (
        <div className="panel">
          <p>Heute gibt es noch keine drei Tagesmissionen.</p>
          <p className="muted small">Sobald die Daten geladen sind, bekommst du eine Lane zugewiesen.</p>
        </div>
      ) : (
        <>
          <p className={`lane-sub${lane.won ? ' won' : ''}`}>
            {lane.won ? `🏆 Sieg gegen ${PATRON_LABEL[lane.patron]}!` : `⚔ ${LANE_NAME[lane.lane]} gegen ${PATRON_LABEL[lane.patron]}`}
          </p>

          {s.map ? <LaneMap map={s.map} lane={lane} /> : (
            <div className="panel"><p className="muted small">Die Map wird mit den übrigen Daten geladen – einmal mit Internet öffnen.</p></div>
          )}

          <div className="panel">
            <h2>Ziele</h2>
            <ol className="lane-list">
              {lane.targets.map((t, i) => {
                const down = t.hp <= 0
                const pct = hpPercent(t.hp)
                return (
                  <li key={t.kind} className={down ? 'down' : i === lane.front ? 'front' : undefined}>
                    <span className="lane-icon"><MapSymbolIcon kind={t.kind} lane={lane.lane} size={30} /></span>
                    <span className="lane-list-main">
                      <span className="lane-list-head">
                        <b>{targetLabel(t.kind, lane.patron)}</b>
                        <span className="small">{down ? '💥 zerstört' : `${pct} % Leben`}</span>
                      </span>
                      {!down && <span className="lane-hp"><span style={{ width: `${pct}%` }} /></span>}
                      <span className="muted small">
                        {down ? `durch: ${t.by}` : i === lane.front ? 'Nächstes Ziel – die Mission, die am weitesten ist, macht Schaden' : 'Danach'}
                      </span>
                    </span>
                  </li>
                )
              })}
            </ol>
          </div>

          <div className="panel">
            <h2>Missionen</h2>
            <MissionList missions={s.daily.missions} />
          </div>
        </>
      )}

      <div className="panel">
        <div className="row">
          <h2>Bilanz</h2>
          <button className="link small" onClick={onStats}>Statistik ›</button>
        </div>
        <p className="small">
          <b>{plural(summary.wins, 'Sieg', 'Siege')}</b> · {plural(summary.losses, 'Niederlage', 'Niederlagen')} · Siegesserie {fmt(summary.streak)}
        </p>
        <p className="muted small">
          Jede geschaffte Tagesmission zerstört das vorderste Ziel – in der Reihenfolge, in der du sie schaffst. Fällt der Patron,
          ist der Tag ein Sieg. Sonst zählt er nach Mitternacht als Niederlage, aber nur, wenn du an dem Tag gelernt oder gespielt
          hast. Morgen gibt es eine neue Lane.
        </p>
      </div>
    </div>
  )
}
