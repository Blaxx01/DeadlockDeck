import type { CSSProperties } from 'react'

/** Hintergrund in der Farbe des Heroes (Vorderseiten, Ability-Symbole) */
export function heroGlow(color?: string): CSSProperties | undefined {
  if (!color) return undefined
  return {
    background: `radial-gradient(circle at 50% 40%, color-mix(in srgb, ${color} 38%, var(--panel)) 0%, var(--panel) 72%)`,
  }
}
