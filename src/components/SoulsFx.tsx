import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { getMeta } from '../data/db'
import { effectsEnabled } from '../game/effects'
import { rankForSouls, rankLabel, type RankAsset, type RankState } from '../game/ranks'
import { soulsEvents, type SoulsGain } from '../game/souls'
import { RankBadge } from './RankBadge'

interface Float {
  id: number
  text: string
}

interface Confetto {
  id: number
  style: CSSProperties
}

const CONFETTI_COLORS = ['#e0b25c', '#6dc04b', '#c878f0', '#cc8932', '#4fb3d9', '#ece4d6']

function makeConfetti(): Confetto[] {
  return Array.from({ length: 48 }, (_, id) => ({
    id,
    style: {
      left: `${Math.random() * 100}%`,
      background: CONFETTI_COLORS[id % CONFETTI_COLORS.length],
      animationDelay: `${Math.random() * 0.6}s`,
      animationDuration: `${1.6 + Math.random() * 1.4}s`,
      transform: `rotate(${Math.random() * 360}deg)`,
    },
  }))
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

/** „+10 ◆“ fliegt kurz hoch; beim Aufstieg das Abzeichen mit Konfetti */
export function SoulsFx() {
  const assets = useLiveQuery(() => getMeta<RankAsset[]>('ranks', []), []) ?? []
  const [floats, setFloats] = useState<Float[]>([])
  const [rankUp, setRankUp] = useState<{ rank: RankState; confetti: Confetto[] } | null>(null)
  const nextId = useRef(0)
  const closeRankUp = useCallback(() => setRankUp(null), [])

  useEffect(() => {
    function onSouls(e: Event) {
      const gain = (e as CustomEvent<SoulsGain>).detail
      if (gain.amount > 0 && effectsEnabled()) {
        const id = ++nextId.current
        setFloats(f => [...f.slice(-3), { id, text: `${gain.label ? `${gain.label} ` : ''}+${gain.amount} ◆` }])
        window.setTimeout(() => setFloats(f => f.filter(x => x.id !== id)), 1300)
      }
      const before = rankForSouls(gain.before)
      const after = rankForSouls(gain.after)
      if (after.index > before.index) setRankUp({ rank: after, confetti: effectsEnabled() ? makeConfetti() : [] })
    }
    soulsEvents.addEventListener('souls', onSouls)
    return () => soulsEvents.removeEventListener('souls', onSouls)
  }, [])

  return (
    <>
      <div className="souls-floats" aria-live="polite">
        {floats.map(f => <span key={f.id} className="souls-float">{f.text}</span>)}
      </div>
      {rankUp && <RankUp rank={rankUp.rank} assets={assets} confetti={rankUp.confetti} onClose={closeRankUp} />}
    </>
  )
}
