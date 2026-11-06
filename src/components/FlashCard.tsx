import { useImperativeHandle, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode, type Ref } from 'react'

const SWIPE_THRESHOLD = 90
const TAP_SLOP = 8

export interface FlashCardHandle {
  /** Karte per Button/Tastatur rausfliegen lassen */
  swipe: (known: boolean) => void
}

interface Props {
  ref?: Ref<FlashCardHandle>
  front: ReactNode
  back: ReactNode
  /** Wird nach dem Swipe aufgerufen: true = gewusst */
  onRate: (known: boolean) => void
  flipped: boolean
  onFlip: () => void
  slotClass?: string
  /** z. B. Hintergrund in Hero-Farbe */
  frontStyle?: CSSProperties
  /** Kennenlernen: Wischen in beide Richtungen heißt „Weiter“ */
  intro?: boolean
}

export function FlashCard({ ref, front, back, onRate, flipped, onFlip, slotClass, frontStyle, intro = false }: Props) {
  const [dx, setDx] = useState(0)
  const [leaving, setLeaving] = useState(false)
  /** onControl: Druck begann auf einem Link/Button der Karte (z. B. Build-Pfad) */
  const start = useRef<{ x: number; y: number; id: number; onControl: boolean } | null>(null)
  const [dragging, setDragging] = useState(false)

  function flyOut(known: boolean) {
    if (leaving) return
    setLeaving(true)
    setDx((known ? 1 : -1) * Math.max(window.innerWidth, 400) * 1.2)
    window.setTimeout(() => onRate(known), 180)
  }

  useImperativeHandle(ref, () => ({ swipe: flyOut }))

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (leaving || (e.pointerType === 'mouse' && e.button !== 0)) return
    const onControl = !!(e.target as HTMLElement).closest('button, a, input')
    start.current = { x: e.clientX, y: e.clientY, id: e.pointerId, onControl }
    setDragging(false)
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const s = start.current
    if (!s || s.id !== e.pointerId || !flipped) return
    const mx = e.clientX - s.x
    const my = e.clientY - s.y
    const isDrag = dragging || (Math.abs(mx) > 12 && Math.abs(mx) > Math.abs(my) * 1.2)
    if (isDrag && !dragging) {
      setDragging(true)
      e.currentTarget.setPointerCapture(e.pointerId)
    }
    if (isDrag) setDx(mx)
  }

  function onPointerUp(e: PointerEvent<HTMLDivElement>) {
    const s = start.current
    start.current = null
    if (!s || s.id !== e.pointerId) return
    if (dragging) {
      setDragging(false)
      const mx = e.clientX - s.x
      if (Math.abs(mx) >= SWIPE_THRESHOLD) flyOut(mx > 0)
      else setDx(0)
      return
    }
    // Tipp auf einen Link öffnet ihn (dessen Klick), dreht die Karte aber nicht um – Wischen geht dort trotzdem
    if (!s.onControl && Math.hypot(e.clientX - s.x, e.clientY - s.y) < TAP_SLOP) onFlip()
  }

  function onPointerCancel() {
    start.current = null
    setDragging(false)
    if (!leaving) setDx(0)
  }

  const progress = Math.max(-1, Math.min(1, dx / SWIPE_THRESHOLD))

  return (
    <div className="card-stage">
      <div
        className={`card-swipe${dragging ? ' dragging' : ''}`}
        style={{ transform: `translateX(${dx}px) rotate(${dx / 25}deg)` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      >
        <div className={`card${flipped ? ' flipped' : ''}`}>
          <div className={`face front ${slotClass ?? ''}`} style={frontStyle} aria-hidden={flipped}>{front}</div>
          {/* inert: Links auf der verdeckten Rückseite sind nicht per Tab erreichbar */}
          <div className="face back" aria-hidden={!flipped} inert={!flipped}>{back}</div>
        </div>
        <div className={`swipe-label ${intro ? 'next' : 'known'}`} style={{ opacity: Math.max(0, progress) }}>{intro ? 'Weiter' : 'Gewusst'}</div>
        <div className={`swipe-label ${intro ? 'next right' : 'unknown'}`} style={{ opacity: Math.max(0, -progress) }}>{intro ? 'Weiter' : 'Nicht gewusst'}</div>
      </div>
    </div>
  )
}
