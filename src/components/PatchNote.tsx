import type { PatchRecord } from '../data/patches'

/** Counter-Karten: Änderung der Statistik, kein Spiel-Patch */
function isCounterPatch(patch: PatchRecord): boolean {
  return patch.id.startsWith('counter:')
}

function patchTitle(patch: PatchRecord): string {
  if (isCounterPatch(patch)) return 'Top-Counter geändert'
  return patch.kind === 'added' ? 'Neu im Patch' : 'Geändert im Patch'
}

function patchDate(patch: PatchRecord): string {
  return new Date(patch.detectedAt).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })
}

/** Kleines Badge für Kartenvorderseite und Shop-Kacheln */
export function PatchBadge({ patch, short = false }: { patch: PatchRecord; short?: boolean }) {
  return (
    <span className={`patch-badge${patch.kind === 'added' ? ' added' : ''}`}>
      {short ? (patch.kind === 'added' ? 'Neu' : 'Geändert') : patchTitle(patch)}
    </span>
  )
}

/** Was hat sich geändert? „vorher → nachher“ der angezeigten Werte */
export function PatchNote({ patch }: { patch: PatchRecord }) {
  return (
    <section className={`patch-note${patch.kind === 'added' ? ' added' : ''}`}>
      <h3>{patchTitle(patch)} · erkannt am {patchDate(patch)}</h3>
      {patch.kind === 'added' ? (
        <p className="small">Neu im Spiel – bisher nicht in deinen Daten.</p>
      ) : isCounterPatch(patch) && patch.changes.length > 0 ? (
        <p className="counter-change">
          <span className="before">{patch.changes[0].before}</span>
          <span aria-hidden="true"> → </span>
          <span className="after">{patch.changes[0].after}</span>
        </p>
      ) : patch.changes.length > 0 ? (
        <ul className="patch-diff">
          {patch.changes.map((c, i) => (
            <li key={i}>
              <span className="patch-label">{c.label}</span>
              <span className="patch-values">
                <span className="before">{c.before}</span>
                <span aria-hidden="true"> → </span>
                <span className="after">{c.after}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="small">Einige Spielwerte wurden geändert.</p>
      )}
    </section>
  )
}
