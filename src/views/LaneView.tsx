import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, type CSSProperties } from 'react'
import { MAP_UNITS, MapCanvas, MapSymbolIcon } from '../components/MapCanvas'
import { getMapData } from '../data/mapSync'
import {
  getLaneSummary, hpPercent, LANE_NAME, LANE_TARGETS, laneTargetPoints, PATRON_LABEL, PATRONS, targetLabel, TROPHY_WINS, type LaneState,
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

/** Mid Boss in der Kartenmitte: Lebensring (Fortschritt der Aufgabe) bzw. ✕ */
function BossMark({ point, boss }: { point: MapPoint; boss: NonNullable<LaneState['midBoss']> }) {
  const x = point.x * MAP_UNITS
  const y = point.y * MAP_UNITS
  if (boss.done) {
    const r = 19
    return (
      <g className="lane-map-x" aria-hidden="true">
        <path d={`M${x - r} ${y - r}L${x + r} ${y + r}M${x - r} ${y + r}L${x + r} ${y - r}`} className="under" />
        <path d={`M${x - r} ${y - r}L${x + r} ${y + r}M${x - r} ${y + r}L${x + r} ${y - r}`} />
      </g>
    )
  }
  const r = 38
  const c = 2 * Math.PI * r
  const left = 1 - boss.progress / boss.target
  return (
    <g className="lane-map-ring boss" aria-hidden="true">
      <circle cx={x} cy={y} r={r} className="track" />
      <circle cx={x} cy={y} r={r} className="hp" strokeDasharray={`${c * left} ${c}`} transform={`rotate(-90 ${x} ${y})`} />
    </g>
  )
}

/** Held des Tages auf der Lane: vor dem nächsten Ziel (Richtung eigene Basis) */
function HeroMark({ point, image, name }: { point: MapPoint; image?: string; name: string }) {
  const x = point.x * MAP_UNITS
  const y = (point.y + 0.06) * MAP_UNITS
  const r = 27
  return (
    <g className="lane-map-hero" aria-hidden="true">
      <clipPath id="lane-hero-clip"><circle cx={x} cy={y} r={r} /></clipPath>
      <circle cx={x} cy={y} r={r + 4} className="ring" />
      {image
        ? <image href={image} x={x - r} y={y - r} width={2 * r} height={2 * r} clipPath="url(#lane-hero-clip)" preserveAspectRatio="xMidYMid slice" />
        : <text x={x} y={y} dy="0.36em" textAnchor="middle" fontSize={26}>{name.slice(0, 1)}</text>}
    </g>
  )
}

function LaneMap({ map, lane }: { map: MapData; lane: LaneState }) {
  const points = laneTargetPoints(map, lane.lane)
  const bossPoint = lane.midBoss ? map.points.find(p => p.kind === 'midBoss') : undefined
  const shown = [...LANE_TARGETS.map(k => points[k]), bossPoint].filter((p): p is MapPoint => !!p)
  const destroyed = [
    ...lane.targets.filter(t => t.hp <= 0).map(t => points[t.kind]),
    lane.midBoss?.done ? bossPoint : undefined,
  ].filter((p): p is MapPoint => !!p)
  const front = lane.won ? null : lane.targets[lane.front].kind
  const heroAt = points[lane.targets[Math.min(lane.front, LANE_TARGETS.length - 1)].kind]
  // nur die Lane des Tages
  const data = { ...map, ziplines: map.ziplines.filter(z => z.lane === lane.lane) }
  return (
    <div className="map-frame">
      <MapCanvas data={data} points={shown} highlight={front} dimmed={destroyed}
        label={`Deadlock-Map: ${LANE_NAME[lane.lane]} mit Guardian, Walker und Patron der gegnerischen Basis${lane.hero ? ` – ${lane.hero.name} greift an` : ''}`}>
        <TargetMarks lane={lane} points={points} />
        {bossPoint && lane.midBoss && <BossMark point={bossPoint} boss={lane.midBoss} />}
        {heroAt && lane.hero && <HeroMark point={heroAt} image={lane.hero.image} name={lane.hero.name} />}
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
            {lane.won
              ? `${lane.revenge ? '⚔ Revanche' : '🏆 Sieg'} gegen ${PATRON_LABEL[lane.patron]}!`
              : `⚔ ${LANE_NAME[lane.lane]} gegen ${PATRON_LABEL[lane.patron]}`}
            {lane.revenge && !lane.won && <span className="lane-badge">Revanche</span>}
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
                      {!down && (
                        <span className="muted small">
                          {i === lane.front ? 'Nächstes Ziel – jeder Fortschritt in einer Mission macht Schaden' : 'Danach'}
                        </span>
                      )}
                    </span>
                  </li>
                )
              })}
            </ol>
          </div>

          <div className="panel">
            <h2>Missionen</h2>
            {s.daily.hero && (
              <p className="lane-hero-line small">
                <span className="hero-portrait small">{s.daily.hero.image && <img src={s.daily.hero.image} alt="" draggable={false} />}</span>
                <span><b>{s.daily.hero.name}</b> greift heute mit dir an</span>
              </p>
            )}
            <MissionList missions={s.daily.missions} />
          </div>

          {s.daily.midBoss && (
            <div className="panel lane-boss-panel">
              <div className="row">
                <h2>Mid Boss</h2>
                <span className="small">{s.daily.midBoss.done ? '💜 besiegt' : `${fmt(s.daily.midBoss.progress)} / ${fmt(s.daily.midBoss.def.target)}`}</span>
              </div>
              <p className="small">{s.daily.midBoss.def.title}</p>
              <p className="muted small">
                Freiwilliges Bonusziel. Besiegt bringt er den Rejuvenator: Er schützt deine Siegesserie einmal vor einer
                Niederlage (höchstens einer auf Vorrat).{lane.rejuvenator ? ' ✚ Du hast gerade einen.' : ''}
              </p>
            </div>
          )}
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
        <p className="small lane-trophies">
          {PATRONS.map(p => {
            const got = TROPHY_WINS.filter(t => summary.byPatron[p].wins >= t)
            return <span key={p}>{PATRON_LABEL[p]}: {got.length ? got.map(t => `🏅${t}`).join(' ') : 'noch keine Trophäe'}</span>
          })}
        </p>
        <p className="muted small">
          Jeder Fortschritt in einer Mission macht Schaden; je eine volle Mission an Fortschritt zerstört ein Ziel, der Patron
          fällt mit der dritten. Ein Sieg bringt einen Serien-Bonus (+10 ◆ je Tag der Serie, höchstens +100). Steht der Patron
          um Mitternacht noch, ist der Tag eine Niederlage (nur, wenn du gelernt oder gespielt hast) – und morgen gibt es Revanche
          gegen ihn: Ein Sieg dann bringt den doppelten Serien-Bonus.
        </p>
      </div>
    </div>
  )
}
