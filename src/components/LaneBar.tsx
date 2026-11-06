import { useEffect, useState, type CSSProperties } from 'react'
import { effectsEnabled } from '../game/effects'
import {
  hpPercent, isShown, LANE_NAME, laneAnimationStart, markLaneShown, PATRON_LABEL, targetLabel, type LaneShown, type LaneState,
} from '../game/laneAttack'
import { LANE_COLOR } from '../map/mapSymbols'
import { makeConfetti, type Confetto } from './confetti'
import { MapSymbolIcon } from './MapCanvas'

interface Props {
  lane: LaneState
  /** Zuletzt auf der Startseite gezeigter Stand – von dort laufen die Lebensbalken herunter */
  shown: LaneShown | null
  onOpen: () => void
}

/** Sekunden je Ziel, das sich geändert hat (die Balken laufen nacheinander) */
const STEP = 0.8
const START_MS = 300

/** Lane-Angriff auf der Startseite: Guardian → Walker → Patron mit Lebensbalken; antippen öffnet die Lane-Map */
export function LaneBar({ lane, shown, onOpen }: Props) {
  // Startbild der Animation – einmal beim Öffnen der Startseite festgehalten (ohne Effekte: keins)
  const [from] = useState(() => (effectsEnabled() ? laneAnimationStart(shown, lane) : null))
  const [running, setRunning] = useState(false)
  /** Sieg erst zeigen, wenn der Patron gefallen ist (am Ende der Animation) */
  const [revealed, setRevealed] = useState(false)
  const [confetti, setConfetti] = useState<Confetto[]>([])

  // Geänderte Ziele nacheinander, danach der Sieg
  const changed = lane.targets.map((t, i) => !!from && hpPercent(t.hp) !== hpPercent(from.hp[i]))
  const order = changed.map((c, i) => (c ? changed.slice(0, i).filter(Boolean).length : 0))
  const victory = !!from && !from.won && lane.won
  const total = changed.filter(Boolean).length * STEP

  useEffect(() => {
    if (from && !running) {
      const timer = window.setTimeout(() => {
        setRunning(true)
        if (victory) setConfetti(makeConfetti(total))
      }, START_MS)
      return () => window.clearTimeout(timer)
    }
    // Ab jetzt ist dieser Stand zu sehen (die Animation läuft schon, auch wenn man gleich weitertippt) –
    // nur schreiben, wenn sich etwas geändert hat
    if (!isShown(shown, lane)) void markLaneShown(lane)
  }, [from, running, shown, lane, victory, total])

  useEffect(() => {
    if (!running || !victory || revealed) return
    const timer = window.setTimeout(() => setRevealed(true), total * 1000)
    return () => window.clearTimeout(timer)
  }, [running, victory, revealed, total])

  const start = !!from && !running
  const hp = lane.targets.map((t, i) => (start ? from.hp[i] : t.hp))
  const won = start ? from.won : lane.won && (!victory || revealed)
  const front = hp.findIndex(h => h > 0)
  const patron = PATRON_LABEL[lane.patron]
  const label = `Lane-Angriff: ${LANE_NAME[lane.lane]} gegen ${patron}${lane.won ? ' – Sieg' : ''}. `
    + lane.targets.map(t => `${targetLabel(t.kind, lane.patron)} ${t.hp <= 0 ? 'zerstört' : `${hpPercent(t.hp)} % Leben`}`).join(', ')
    + '. Auf der Map zeigen'

  return (
    <>
      <button className={`lane-bar${won ? ' won' : ''}`} style={{ '--lane': LANE_COLOR[lane.lane] } as CSSProperties} onClick={onOpen} aria-label={label}>
        <span className="lane-head">
          <span className="lane-title">{won ? `🏆 Sieg gegen ${patron}!` : `⚔ ${LANE_NAME[lane.lane]} gegen ${patron}`}</span>
          <span className="lane-more">Map ›</span>
        </span>
        <span className="lane-targets">
          {lane.targets.map((t, i) => {
            const pct = hpPercent(hp[i])
            const fell = running && changed[i] && t.hp <= 0
            return (
              <span key={t.kind} style={{ '--delay': `${order[i] * STEP}s` } as CSSProperties}
                className={`lane-target${pct === 0 ? ' down' : ''}${i === front ? ' front' : ''}${fell ? ' fell' : ''}`}>
                <span className="lane-icon">
                  <MapSymbolIcon kind={t.kind} lane={lane.lane} size={30} />
                  {pct === 0 && <span className="lane-x" aria-hidden="true">✕</span>}
                </span>
                <span className="lane-name">{targetLabel(t.kind, lane.patron)}</span>
                <span className="lane-hp"><span style={{ width: `${pct}%` }} /></span>
                <span className="lane-pct">{pct === 0 ? 'zerstört' : `${pct} %`}</span>
              </span>
            )
          })}
        </span>
        {victory && running && <span className="lane-victory" style={{ '--delay': `${total}s` } as CSSProperties} aria-hidden="true">Sieg!</span>}
      </button>
      {confetti.length > 0 && (
        <div className="lane-confetti" aria-hidden="true">
          {confetti.map(c => <span key={c.id} className="confetto" style={c.style} />)}
        </div>
      )}
    </>
  )
}
