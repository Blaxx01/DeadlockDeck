import { useEffect, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { formatDay, niceStep, type SoulsPoint } from '../game/stats'

const HEIGHT = 160
const PAD = { left: 40, right: 12, top: 12, bottom: 24 }

/** Breite des Elements in Pixeln (SVG in echten Pixeln: Linien bleiben 2 px, Schrift unskaliert) */
function useWidth<T extends HTMLElement>(): [(el: T | null) => void, number] {
  const [el, setEl] = useState<T | null>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    if (!el) return
    // meldet die Breite auch gleich beim Start der Beobachtung
    const observer = new ResizeObserver(() => setWidth(el.clientWidth))
    observer.observe(el)
    return () => observer.disconnect()
  }, [el])
  return [setEl, width]
}

const fmt = (n: number) => n.toLocaleString('de-DE')

function signed(n: number): string {
  return n > 0 ? `+${fmt(n)}` : n < 0 ? `−${fmt(-n)}` : '±0'
}

/** Souls-Verlauf: Stand am Ende jedes Tages – Linie mit Fläche, Fadenkreuz und Tooltip */
export function SoulsChart({ series }: { series: SoulsPoint[] }) {
  const [wrapRef, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const n = series.length

  if (n === 0) return <p className="muted small">Noch keine Souls – die erste Lern-Session bringt welche.</p>

  const first = series[0]
  const last = series[n - 1]
  const max = Math.max(1, ...series.map(p => p.total))
  const step = niceStep(max, 3)
  const top = Math.ceil(max / step) * step
  const plotW = Math.max(1, width - PAD.left - PAD.right)
  const plotH = HEIGHT - PAD.top - PAD.bottom
  const x = (i: number) => PAD.left + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW)
  const y = (v: number) => PAD.top + (1 - v / top) * plotH
  const line = series.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.total).toFixed(1)}`).join('')
  const area = `${line}L${x(n - 1).toFixed(1)},${y(0)}L${x(0).toFixed(1)},${y(0)}Z`
  const ticks: number[] = []
  for (let v = 0; v <= top; v += step) ticks.push(v)
  const point = hover !== null ? series[hover] : undefined
  const summary = `Souls-Verlauf: ${fmt(first.total)} am ${formatDay(first.date)}, heute ${fmt(last.total)}`

  function onMove(e: PointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const i = Math.round(((e.clientX - rect.left - PAD.left) / plotW) * (n - 1))
    setHover(Math.max(0, Math.min(n - 1, i)))
  }

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return
    e.preventDefault()
    const current = hover ?? n - 1
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : current + (e.key === 'ArrowRight' ? 1 : -1)
    setHover(Math.max(0, Math.min(n - 1, next)))
  }

  return (
    <div className="souls-chart" ref={wrapRef} tabIndex={0} aria-label={summary} onKeyDown={onKey} onBlur={() => setHover(null)}>
      {width > 0 && (
        <svg
          width={width}
          height={HEIGHT}
          viewBox={`0 0 ${width} ${HEIGHT}`}
          aria-hidden="true"
          onPointerMove={onMove}
          onPointerDown={onMove}
          onPointerLeave={e => { if (e.pointerType === 'mouse') setHover(null) }}
        >
          {ticks.map(v => (
            <g key={v}>
              <line className="grid" x1={PAD.left} x2={width - PAD.right} y1={y(v)} y2={y(v)} />
              <text className="axis" x={PAD.left - 6} y={y(v)} dy="0.32em" textAnchor="end">{fmt(v)}</text>
            </g>
          ))}
          <text className="axis" x={x(0)} y={HEIGHT - 6} textAnchor={n === 1 ? 'middle' : 'start'}>{formatDay(first.date)}</text>
          {n > 1 && <text className="axis" x={x(n - 1)} y={HEIGHT - 6} textAnchor="end">Heute</text>}
          <path className="area" d={area} />
          <path className="line" d={line} />
          {point && hover !== null && (
            <line className="crosshair" x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + plotH} />
          )}
          <circle className="dot" cx={x(n - 1)} cy={y(last.total)} r={4} />
          {point && hover !== null && hover !== n - 1 && <circle className="dot" cx={x(hover)} cy={y(point.total)} r={4} />}
        </svg>
      )}
      {point && hover !== null && (
        <div
          className="chart-tip small"
          style={{ left: Math.max(70, Math.min(width - 70, x(hover))), top: Math.max(0, y(point.total) - 52) }}
        >
          <b>{formatDay(point.date)}</b>
          <span>{fmt(point.total)} ◆ <span className="muted">({signed(point.delta)})</span></span>
        </div>
      )}
      <span className="sr-only" aria-live="polite">
        {point ? `${formatDay(point.date)}: ${fmt(point.total)} Souls, ${signed(point.delta)}` : ''}
      </span>
    </div>
  )
}
