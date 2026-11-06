import { useMemo, useState, type SyntheticEvent } from 'react'
import { describeDay, formatDay, type CalendarDay } from '../game/stats'

const WEEKDAYS = ['Mo', '', 'Mi', '', 'Fr', '', 'So']
const MONTHS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']

/** Monat über der ersten Woche, die einen Monatsersten enthält (vorne nur, wenn Platz ist) */
function monthLabels(weeks: readonly CalendarDay[][]): string[] {
  const labels = weeks.map(week => {
    const first = week.find(d => d.date.endsWith('-01'))
    return first ? MONTHS[Number(first.date.slice(5, 7)) - 1] : ''
  })
  if (weeks.length > 0 && !labels.slice(0, 3).some(Boolean)) labels[0] = MONTHS[Number(weeks[0][0].date.slice(5, 7)) - 1]
  return labels
}

/** Kalender der Lerntage (wie bei GitHub): Spalten = Wochen, Zeilen = Mo–So */
export function LearnCalendar({ weeks, goal }: { weeks: CalendarDay[][]; goal: number }) {
  const [selected, setSelected] = useState<string | null>(null)
  const byDate = useMemo(() => new Map(weeks.flat().map(d => [d.date, d])), [weeks])
  const months = useMemo(() => monthLabels(weeks), [weeks])
  const past = weeks.flat().filter(d => !d.future)
  const learned = past.filter(d => d.reviewed > 0)
  const goals = past.filter(d => d.reviewed >= goal).length
  const summary = `Letzte ${weeks.length} Wochen: ${learned.length} Lerntage · ${goals}× Tagesziel`
  const day = selected ? byDate.get(selected) : undefined

  // Ein Handler für alle Zellen: Antippen oder Überfahren zeigt den Tag
  function pick(e: SyntheticEvent) {
    const date = (e.target as HTMLElement).dataset.date
    if (date && !byDate.get(date)?.future) setSelected(date)
  }

  return (
    <div className="cal">
      <div
        className="cal-grid"
        role="img"
        aria-label={summary}
        style={{ gridTemplateColumns: `1.7em repeat(${weeks.length}, minmax(0, 1fr))` }}
        onPointerOver={pick}
        onClick={pick}
      >
        {months.map((m, i) => m && <span key={`m${i}`} className="cal-month" style={{ gridColumn: i + 2, gridRow: 1 }}>{m}</span>)}
        {WEEKDAYS.map((w, i) => w && <span key={`w${i}`} className="cal-weekday" style={{ gridColumn: 1, gridRow: i + 2 }}>{w}</span>)}
        {weeks.map((week, wi) => week.map((d, di) => (
          <span
            key={d.date}
            data-date={d.date}
            className={`cal-day lvl-${d.level}${d.shielded ? ' shielded' : ''}${d.future ? ' future' : ''}${d.date === selected ? ' sel' : ''}`}
            style={{ gridColumn: wi + 2, gridRow: di + 2 }}
            title={d.future ? undefined : describeDay(d, goal)}
          />
        )))}
      </div>
      <p className="small cal-info" aria-live="polite">{day ? describeDay(day, goal) : summary}</p>
      <span className="cal-legend small">
        <span className="legend-item"><span className="swatch lvl-1" aria-hidden="true" />gelernt</span>
        <span className="legend-item"><span className="swatch lvl-2" aria-hidden="true" />Tagesziel</span>
        <span className="legend-item"><span className="swatch lvl-3" aria-hidden="true" />{2 * goal}+ Karten</span>
        <span className="legend-item"><span className="swatch lvl-0 shielded" aria-hidden="true" />Streak-Schutz</span>
      </span>
      <details className="table-view">
        <summary className="small">Als Liste</summary>
        {learned.length === 0 && !past.some(d => d.shielded)
          ? <p className="muted small">Noch keine Lerntage.</p>
          : (
            <table className="small">
              <thead><tr><th>Tag</th><th>Karten</th><th>Tagesziel</th></tr></thead>
              <tbody>
                {past.filter(d => d.reviewed > 0 || d.shielded).reverse().map(d => (
                  <tr key={d.date}>
                    <td>{formatDay(d.date)}</td>
                    <td>{d.reviewed}</td>
                    <td>{d.reviewed >= goal ? '✓' : d.shielded ? '🛡 Schutz' : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </details>
    </div>
  )
}
