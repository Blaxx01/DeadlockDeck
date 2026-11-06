import { useEffect, useRef, useState } from 'react'
import { daysAgoText, exportBackup, getBackupStatus, parseBackup, prefersShare, restoreBackup, type BackupStatus } from '../data/backup'
import { isStoragePersisted } from '../data/persist'
import { MAP_GROUP_LABEL, MAP_QUIZ_GROUPS, type MapGroup } from '../map/mapData'
import { MAP_QUESTION_LABEL, MAP_QUESTION_TYPES, type MapQuestionType } from '../map/mapQuiz'
import { db, getSettings, saveSettings, setMeta, type Settings } from '../data/db'
import { deckLabel, type DeckId } from '../decks'
import { resetMilestonesInTx } from '../game/milestones'
import { setEffectsEnabled } from '../game/effects'
import {
  GUESS_KIND_LABEL, GUESS_KINDS, LEARNED_ONLY_MIN, QUIZ_KIND_LABEL, QUIZ_KINDS, QUIZ_SCOPE_LABEL, QUIZ_SCOPES, SLOT_LABEL,
  type GuessKind, type QuizKind, type QuizScope, type SlotType,
} from '../data/model'

interface Props {
  onBack: () => void
  onSync: () => void
  onCacheImages: () => void
  syncing: boolean
}

const SLOTS: SlotType[] = ['weapon', 'vitality', 'spirit']
/** Decks, bei denen man die Antwort eintippen kann */
const TYPE_DECKS: DeckId[] = ['items', 'counters']

/** Letztes Backup und ob der Speicher dauerhaft ist */
async function loadBackupInfo(): Promise<{ status: BackupStatus; persisted?: boolean }> {
  const [status, persisted] = await Promise.all([getBackupStatus(), isStoragePersisted()])
  return { status, persisted }
}

/** Erklärung zur Einstellung „Gefragt wird“ */
const SCOPE_HELP: Record<QuizScope, string> = {
  'learned-first': 'Zuerst Karten, die du schon gelernt hast (im Lernmodus mindestens einmal bewertet). Reicht das nicht, '
    + 'kommen neue dazu – mit „Neu“ markiert; ein Fehler dort zählt nicht als Schwäche.',
  'learned-only': 'Nur Karten, die du schon gelernt hast (im Lernmodus mindestens einmal bewertet). Am Anfang sind Quiz- und '
    + `Hero-Runden kürzer; Sprint und Überleben brauchen mindestens ${LEARNED_ONLY_MIN} gelernte Karten.`,
  all: 'Alle Karten, egal ob schon gelernt. Jeder Fehler zählt als Schwäche.',
}

export function SettingsView({ onBack, onSync, onCacheImages, syncing }: Props) {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const [backupInfo, setBackupInfo] = useState<Awaited<ReturnType<typeof loadBackupInfo>> | null>(null)
  const [share] = useState(prefersShare)

  useEffect(() => { getSettings().then(setSettings) }, [])
  useEffect(() => { loadBackupInfo().then(setBackupInfo) }, [])

  async function refreshBackupInfo() {
    setBackupInfo(await loadBackupInfo())
  }

  async function onExport(download: boolean) {
    const result = await exportBackup({ download })
    if (result !== 'cancelled') setMessage(result === 'shared' ? 'Backup gesichert.' : 'Backup heruntergeladen.')
    await refreshBackupInfo()
  }

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

  function toggleGuessKind(kind: GuessKind) {
    if (!settings) return
    const has = settings.guessKinds.includes(kind)
    const guessKinds = has ? settings.guessKinds.filter(k => k !== kind) : GUESS_KINDS.filter(k => k === kind || settings.guessKinds.includes(k))
    if (guessKinds.length === 0) return
    update({ guessKinds })
  }

  function toggleMapGroup(group: MapGroup) {
    if (!settings) return
    const on = settings.mapGroups.includes(group)
    const mapGroups = on ? settings.mapGroups.filter(g => g !== group) : MAP_QUIZ_GROUPS.filter(g => g === group || settings.mapGroups.includes(g))
    if (mapGroups.length === 0) return
    update({ mapGroups })
  }

  function toggleMapType(type: MapQuestionType) {
    if (!settings) return
    const on = settings.mapQuestionTypes.includes(type)
    const mapQuestionTypes = on ? settings.mapQuestionTypes.filter(t => t !== type) : MAP_QUESTION_TYPES.filter(t => t === type || settings.mapQuestionTypes.includes(t))
    if (mapQuestionTypes.length === 0) return
    update({ mapQuestionTypes })
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
      await refreshBackupInfo()
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Import fehlgeschlagen.')
    }
  }

  function toggleTyping(deck: DeckId) {
    if (!settings) return
    const on = settings.typeAnswers.includes(deck)
    update({ typeAnswers: on ? settings.typeAnswers.filter(d => d !== deck) : [...settings.typeAnswers, deck] })
  }

  async function resetProgress() {
    if (!confirm('Gesamten Lernfortschritt löschen? Das kann nicht rückgängig gemacht werden (außer mit einem Backup).')) return
    await db.transaction('rw', [db.reviews, db.days, db.souls, db.meta, db.mistakes], async () => {
      await db.reviews.clear()
      await db.days.clear()
      await db.mistakes.clear()
      // Souls & Rang gehören zum Fortschritt
      await db.souls.clear()
      await setMeta('soulsTotal', 0)
      await setMeta('missions', null)
      // Lane-Angriff: Bilanz neu ab heute (Siege und Niederlagen kommen aus dem Souls-Verlauf)
      await setMeta('laneStart', null)
      await setMeta('laneShown', null)
      await resetMilestonesInTx(db)
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
        <label className="field toggle-field">
          <span>
            Neue Karten erst kennenlernen<br />
            <span className="muted small">Beim ersten Mal umdrehen, lesen, „Weiter“ – ein paar Karten später die erste Abfrage</span>
          </span>
          <input type="checkbox" checked={settings.introNew} onChange={e => void update({ introNew: e.target.checked })} />
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
        <div className="field">
          <span>Antwort eintippen</span>
          <div className="chips">
            {TYPE_DECKS.map(deck => (
              <button key={deck} className={`chip toggle${settings.typeAnswers.includes(deck) ? ' on' : ''}`}
                onClick={() => toggleTyping(deck)} aria-pressed={settings.typeAnswers.includes(deck)}>
                {deckLabel(deck)}
              </button>
            ))}
          </div>
        </div>
        <p className="muted small">
          Statt nur umzudrehen tippst du den Namen ein (bei Counter eins der Top-3-Items) – kleine Tippfehler und ein
          eindeutiger Anfang zählen. Danach ist „Gewusst“ bzw. „Nicht gewusst“ vorgewählt.
        </p>
      </div>

      <div className="panel">
        <h2>Spielen</h2>
        <div className="field">
          <span>Gefragt wird</span>
        </div>
        <div className="segmented three" role="group" aria-label="Gefragt wird">
          {QUIZ_SCOPES.map(scope => (
            <button key={scope} className={settings.quizScope === scope ? 'on' : ''} aria-pressed={settings.quizScope === scope}
              onClick={() => update({ quizScope: scope })}>
              {QUIZ_SCOPE_LABEL[scope]}
            </button>
          ))}
        </div>
        <p className="muted small">Gilt für Quiz, Überleben, Sprint und Hero erraten. {SCOPE_HELP[settings.quizScope]}</p>
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
        <p className="muted small">Fragetypen und Kategorien von oben gelten auch für Überleben; die Kategorien auch für den Sprint.</p>
      </div>

      <div className="panel">
        <h2>Hero erraten</h2>
        <div className="field">
          <span>Varianten</span>
        </div>
        <div className="chips">
          {GUESS_KINDS.map(kind => (
            <button key={kind} className={`chip toggle${settings.guessKinds.includes(kind) ? ' on' : ''}`}
              onClick={() => toggleGuessKind(kind)} aria-pressed={settings.guessKinds.includes(kind)}>
              {GUESS_KIND_LABEL[kind]}
            </button>
          ))}
        </div>
      </div>

      <div className="panel">
        <h2>Map-Quiz</h2>
        <div className="field">
          <span>Bereiche</span>
        </div>
        <div className="chips" role="group" aria-label="Map-Quiz: Bereiche">
          {MAP_QUIZ_GROUPS.map(group => (
            <button key={group} className={`chip toggle${settings.mapGroups.includes(group) ? ' on' : ''}`}
              onClick={() => toggleMapGroup(group)} aria-pressed={settings.mapGroups.includes(group)}>
              {MAP_GROUP_LABEL[group]}
            </button>
          ))}
        </div>
        <div className="field">
          <span>Fragetypen</span>
        </div>
        <div className="chips" role="group" aria-label="Map-Quiz: Fragetypen">
          {MAP_QUESTION_TYPES.map(type => (
            <button key={type} className={`chip toggle${settings.mapQuestionTypes.includes(type) ? ' on' : ''}`}
              onClick={() => toggleMapType(type)} aria-pressed={settings.mapQuestionTypes.includes(type)}>
              {MAP_QUESTION_LABEL[type]}
            </button>
          ))}
        </div>
      </div>

      <div className="panel">
        <h2>Effekte</h2>
        <label className="field toggle-field">
          <span>Animationen und Vibration<br /><span className="muted small">„+10 ◆“, Aufstieg mit Konfetti, Lane-Angriff, Vibration bei Fehlern</span></span>
          <input type="checkbox" checked={settings.effects}
            onChange={e => { setEffectsEnabled(e.target.checked); void update({ effects: e.target.checked }) }} />
        </label>
      </div>

      <div className="panel">
        <h2>Daten</h2>
        <button onClick={onSync} disabled={syncing || !navigator.onLine}>{syncing ? 'Aktualisiere…' : 'Items neu laden'}</button>
        <button onClick={onCacheImages} disabled={!navigator.onLine}>Alle Bilder offline speichern</button>
      </div>

      <div className="panel">
        <h2>Backup</h2>
        <p className="muted small">Der Fortschritt liegt nur auf diesem Gerät. Browserdaten löschen = Fortschritt weg. Mach ab und zu ein Backup.</p>
        {backupInfo && (
          <ul className="backup-info small">
            <li>
              {backupInfo.status.lastBackupAt === undefined
                ? 'Noch kein Backup.'
                : `Letztes Backup: ${daysAgoText(backupInfo.status.daysSince ?? 0)} (${new Date(backupInfo.status.lastBackupAt).toLocaleDateString('de-DE')})`}
            </li>
            {backupInfo.persisted === true && <li className="good">✓ Dauerhafter Speicher: Der Browser löscht deinen Fortschritt nicht von selbst.</li>}
            {backupInfo.persisted === false && (
              <li>Kein dauerhafter Speicher: Bei Platzmangel darf der Browser deinen Fortschritt löschen – ein Backup schützt davor.</li>
            )}
          </ul>
        )}
        <button onClick={() => void onExport(false)}>{share ? 'Fortschritt sichern (Teilen …)' : 'Fortschritt exportieren'}</button>
        {share && <button onClick={() => void onExport(true)}>Als Datei herunterladen</button>}
        <button onClick={() => fileInput.current?.click()}>Backup importieren</button>
        <input ref={fileInput} type="file" accept="application/json,.json,text/plain,.txt" hidden
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
