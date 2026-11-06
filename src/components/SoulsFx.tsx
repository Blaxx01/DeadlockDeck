import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { getMeta } from '../data/db'
import { effectsEnabled } from '../game/effects'
import { laneEvents, PATRON_LABEL, targetLabel, type LaneChange } from '../game/laneAttack'
import { rankForSouls, rankLabel, type RankAsset, type RankState } from '../game/ranks'
import { soulsEvents, type SoulsGain } from '../game/souls'
import { LANE_COLOR } from '../map/mapSymbols'
import { makeConfetti, type Confetto } from './confetti'
import { RankBadge } from './RankBadge'

interface Float {
  id: number
  text: string
  /** Lane-Angriff: Lebensbalken in Lane-Farbe (Prozent vorher → nachher) */
  hp?: { color: string; from: number; to: number }
  /** Länger stehen lassen (zerstört, Sieg) */
  long?: boolean
}

/** Lane-Angriff: was eingeblendet wird */
function laneFloats(change: LaneChange): Omit<Float, 'id'>[] {
  const { state } = change
  const out: Omit<Float, 'id'>[] = []
  for (const kind of change.destroyed) {
    if (kind !== 'patron' || !change.won) out.push({ text: `💥 ${targetLabel(kind, state.patron)} zerstört!`, long: true })
  }
  if (change.won) out.push({ text: `🏆 Sieg gegen ${PATRON_LABEL[state.patron]}!`, long: true })
  if (change.damage) {
    const { kind, before, after } = change.damage
    out.push({
      text: `⚔ ${targetLabel(kind, state.patron)} −${before - after} %`,
      hp: { color: LANE_COLOR[state.lane], from: before, to: after },
    })
  }
  return out
}

/** Aufstieg: Abzeichen, neuer Rang, Konfetti (ohne Effekte schlicht) */
function RankUp({ rank, assets, confetti, onClose }: { rank: RankState; assets: readonly RankAsset[]; confetti: Confetto[]; onClose: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(onClose, 6000)
    return () => window.clearTimeout(timer)
  }, [onClose])
  return (
    <div className="rankup" role="dialog" aria-label={`Aufstieg: ${rankLabel(rank, assets)}`} onClick={onClose}>
      <div className="rankup-confetti" aria-hidden="true">
        {confetti.map(c => <span key={c.id} className="confetto" style={c.style} />)}
      </div>
      <div className="rankup-card">
        <RankBadge rank={rank} assets={assets} className="big" />
        <div className="rankup-title">Aufstieg!</div>
        <div className="rankup-rank">{rankLabel(rank, assets)}</div>
        <button className="primary" onClick={onClose}>Weiter</button>
      </div>
    </div>
  )
}

/** „+10 ◆“ fliegt kurz hoch (ebenso Schaden im Lane-Angriff); beim Aufstieg das Abzeichen mit Konfetti */
export function SoulsFx() {
  const assets = useLiveQuery(() => getMeta<RankAsset[]>('ranks', []), []) ?? []
  const [floats, setFloats] = useState<Float[]>([])
  const [rankUp, setRankUp] = useState<{ rank: RankState; confetti: Confetto[] } | null>(null)
  const nextId = useRef(0)
  const closeRankUp = useCallback(() => setRankUp(null), [])

  useEffect(() => {
    function show(items: Omit<Float, 'id'>[]) {
      for (const item of items) {
        const id = ++nextId.current
        setFloats(f => [...f.slice(-3), { ...item, id }])
        window.setTimeout(() => setFloats(f => f.filter(x => x.id !== id)), item.long ? 2400 : item.hp ? 1800 : 1300)
      }
    }
    function onSouls(e: Event) {
      const gain = (e as CustomEvent<SoulsGain>).detail
      if (gain.amount > 0 && effectsEnabled()) show([{ text: `${gain.label ? `${gain.label} ` : ''}+${gain.amount} ◆` }])
      const before = rankForSouls(gain.before)
      const after = rankForSouls(gain.after)
      if (after.index > before.index) setRankUp({ rank: after, confetti: effectsEnabled() ? makeConfetti() : [] })
    }
    function onLane(e: Event) {
      if (effectsEnabled()) show(laneFloats((e as CustomEvent<LaneChange>).detail))
    }
    soulsEvents.addEventListener('souls', onSouls)
    laneEvents.addEventListener('lane', onLane)
    return () => {
      soulsEvents.removeEventListener('souls', onSouls)
      laneEvents.removeEventListener('lane', onLane)
    }
  }, [])

  return (
    <>
      <div className="souls-floats" aria-live="polite">
        {floats.map(f => (
          <span key={f.id} className={`souls-float${f.hp ? ' lane-float' : ''}${f.long ? ' long' : ''}`}
            style={f.hp ? { '--lane': f.hp.color, '--from': `${f.hp.from}%`, '--to': `${f.hp.to}%` } as CSSProperties : undefined}>
            {f.text}
            {f.hp && <span className="lane-float-bar" aria-hidden="true"><span /></span>}
          </span>
        ))}
      </div>
      {rankUp && <RankUp rank={rankUp.rank} assets={assets} confetti={rankUp.confetti} onClose={closeRankUp} />}
    </>
  )
}
