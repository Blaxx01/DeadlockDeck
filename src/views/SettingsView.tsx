import { useEffect, useRef, useState } from 'react'
import { createBackup, downloadBackup, parseBackup, restoreBackup } from '../data/backup'
import { db, getSettings, saveSettings, type Settings } from '../data/db'
import { QUIZ_KIND_LABEL, QUIZ_KINDS, SLOT_LABEL, type QuizKind, type SlotType } from '../data/model'

interface Props {
  onBack: () => void
  onSync: () => void
  onCacheImages: () => void
  syncing: boolean
}

const SLOTS: SlotType[] = ['weapon', 'vitality', 'spirit']

export function SettingsView({ onBack, onSync, onCacheImages, syncing }: Props) {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => { getSettings().then(setSettings) }, [])

  async function update(patch: Partial<Settings>) {
    if (!settings) return
    const next = { ...settings, ...patch }
    setSettings(next)
    await saveSettings(next)
  }

  function toggleQuizKind(kind: QuizKind) {
    if (!settings) return
    const has = settings.quizKinds.includes(kind)
    const quizKinds = has ? settings.quizKinds.filter(k => k !== kind) : QUIZ_KINDS.filter(k => k === kind || settings.quizKinds.includes(k))
    if (quizKinds.length === 0) return
    update({ quizKinds })
  }

  function toggleSlot(slot: SlotType) {
    if (!settings) return
    const has = settings.slots.includes(slot)
    const slots = has ? settings.slots.filter(s => s !== slot) : [...settings.slots, slot]
    if (slots.length === 0) return
    update({ slots })
  }

  async function onImport(file: File) {
    try {
      const backup = parseBackup(await file.text())
      if (!confirm(`Backup vom ${new Date(backup.exportedAt).toLocaleString('de-DE')} einspielen? Der aktuelle Fortschritt wird ersetzt.`)) return
      await restoreBackup(backup)
      setSettings(await getSettings())
      setMessage(`Backup eingespielt (${backup.reviews.length} Karten).`)
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Import fehlgeschlagen.')
    }
  }

  async function resetProgress() {
    if (!confirm('Gesamten Lernfortschritt löschen? Das kann nicht rückgängig gemacht werden (außer mit einem Backup).')) return
    await db.transaction('rw', db.reviews, db.days, async () => {
      await db.reviews.clear()
      await db.days.clear()
    })
    setMessage('Fortschritt gelöscht.')
  }

  if (!settings) return <div className="center muted">Lade…</div>

  return (
    <div className="settings">
      <header className="home-head">
        <button className="icon-btn" onClick={onBack} aria-label="Zurück">←</button>
        <h1>Einstellungen</h1>
        <span />
      </header>

      <div className="panel">
        <h2>Lernen</h2>
        <label className="field">
          <span>Tagesziel (Bewertungen)</span>
          <input type="number" min={1} max={500} value={settings.dailyGoal}
            onChange={e => update({ dailyGoal: Math.max(1, Number(e.target.value) || 1) })} />
        </label>
        <label className="field">
          <span>Neue Karten pro Tag (je Deck)</span>
          <input type="number" min={0} max={200} value={settings.newPerDay}
            onChange={e => update({ newPerDay: Math.max(0, Number(e.target.value) || 0) })} />
        </label>
        <div className="field">
          <span>Item-Kategorien</span>
          <div className="chips">
            {SLOTS.map(slot => (
              <button key={slot} className={`chip toggle slot-${slot}${settings.slots.includes(slot) ? ' on' : ''}`}
                onClick={() => toggleSlot(slot)} aria-pressed={settings.slots.includes(slot)}>
                {SLOT_LABEL[slot]}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="panel">
        <h2>Quiz</h2>
        <div className="field">
          <span>Fragetypen</span>
        </div>
        <div className="chips">
          {QUIZ_KINDS.map(kind => (
            <button key={kind} className={`chip toggle${settings.quizKinds.includes(kind) ? ' on' : ''}`}
              onClick={() => toggleQuizKind(kind)} aria-pressed={settings.quizKinds.includes(kind)}>
              {QUIZ_KIND_LABEL[kind]}
            </button>
          ))}
        </div>
        <p className="muted small">Die Kategorien von oben gelten auch fürs Quiz.</p>
      </div>

      <div className="panel">
        <h2>Daten</h2>
        <button onClick={onSync} disabled={syncing || !navigator.onLine}>{syncing ? 'Aktualisiere…' : 'Items neu laden'}</button>
        <button onClick={onCacheImages} disabled={!navigator.onLine}>Alle Bilder offline speichern</button>
      </div>

      <div className="panel">
        <h2>Backup</h2>
        <p className="muted small">Der Fortschritt liegt nur auf diesem Gerät. Browserdaten löschen = Fortschritt weg. Mach ab und zu ein Backup.</p>
        <button onClick={async () => downloadBackup(await createBackup())}>Fortschritt exportieren</button>
        <button onClick={() => fileInput.current?.click()}>Backup importieren</button>
        <input ref={fileInput} type="file" accept="application/json,.json" hidden
          onChange={e => { const f = e.target.files?.[0]; if (f) onImport(f); e.target.value = '' }} />
        <button className="danger" onClick={resetProgress}>Fortschritt löschen</button>
      </div>

      {message && <p className="panel msg">{message}</p>}

      <p className="muted small center-text">
        Daten: <a href="https://deadlock-api.com" target="_blank" rel="noreferrer">deadlock-api.com</a> · Inoffizielles Fan-Projekt, nicht mit Valve verbunden.
      </p>
    </div>
  )
}
