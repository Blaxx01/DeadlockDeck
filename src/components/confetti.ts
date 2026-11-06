import type { CSSProperties } from 'react'

/** Ein Konfetti-Stück (Aufstieg, Sieg im Lane-Angriff) */
export interface Confetto {
  id: number
  style: CSSProperties
}

const CONFETTI_COLORS = ['#e0b25c', '#6dc04b', '#c878f0', '#cc8932', '#4fb3d9', '#ece4d6']

/** Zufällig verteilt – nur in Ereignissen aufrufen, nicht beim Rendern. `delay`: Start in Sekunden */
export function makeConfetti(delay = 0, colors: readonly string[] = CONFETTI_COLORS): Confetto[] {
  return Array.from({ length: 48 }, (_, id) => ({
    id,
    style: {
      left: `${Math.random() * 100}%`,
      background: colors[id % colors.length],
      animationDelay: `${delay + Math.random() * 0.6}s`,
      animationDuration: `${1.6 + Math.random() * 1.4}s`,
      transform: `rotate(${Math.random() * 360}deg)`,
    },
  }))
}
