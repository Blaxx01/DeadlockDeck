import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { db } from '../data/db'
import { NOTE_MAX_LENGTH, saveNote } from '../game/notes'
import { LEECH_LAPSES } from '../game/weakness'

/** Merkhilfe der Karte und wie oft sie nach dem Lernen vergessen wurde (live) */
function useNoteState(cardId: string) {
  return useLiveQuery(async () => {
    const [note, review] = await Promise.all([db.notes.get(cardId), db.reviews.get(cardId)])
    return { text: note?.text ?? '', lapses: review?.lapses ?? 0 }
  }, [cardId])
}

/** Eingabe einer Merkhilfe: Speichern, Löschen, Abbrechen (Esc), Strg+Enter speichert */
export function NoteForm({ cardId, initial, onDone }: { cardId: string; initial: string; onDone: () => void }) {
  const [text, setText] = useState(initial)
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus({ preventScroll: true })
    el.setSelectionRange(el.value.length, el.value.length)
  }, [])

  async function save() {
    await saveNote(cardId, text)
    onDone()
  }

  async function remove() {
    await saveNote(cardId, '')
    onDone()
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Tasten gehören dem Eingabefeld – nicht der Lernsession oder Seite dahinter (Leertaste, Pfeile, Esc)
    e.stopPropagation()
    if (e.key === 'Escape') onDone()
    else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void save()
  }

  return (
    <div className="note-form">
      <textarea
        ref={ref}
        value={text}
        rows={3}
        maxLength={NOTE_MAX_LENGTH}
        placeholder="Eselsbrücke, Bild im Kopf, Unterschied zu einer ähnlichen Karte …"
        aria-label="Merkhilfe"
        onChange={e => setText(e.target.value)}
        onKeyDown={onKey}
      />
      <div className="note-actions">
        <button className="primary" onClick={() => void save()}>Speichern</button>
        <button onClick={onDone}>Abbrechen</button>
        {initial && <button className="danger" onClick={() => void remove()}>Löschen</button>}
        <span className="muted small note-count">{text.length}/{NOTE_MAX_LENGTH}</span>
      </div>
    </div>
  )
}

/**
 * Oben auf der Kartenrückseite: die Merkhilfe – oder bei hartnäckigen Karten der Hinweis, eine zu schreiben.
 * Sonst nichts (der kleine Knopf steht dann unten, siehe NoteButton).
 */
export function CardNote({ cardId, onEdit }: { cardId: string; onEdit: () => void }) {
  const s = useNoteState(cardId)
  if (!s) return null
  const leech = s.lapses >= LEECH_LAPSES
  if (s.text) {
    return (
      <div className={`card-note${leech ? ' leech' : ''}`}>
        <span className="card-note-head">
          <span className="card-note-label">💡 Deine Merkhilfe</span>
          <button className="link small" onClick={onEdit}>Bearbeiten</button>
        </span>
        <p>{s.text}</p>
      </div>
    )
  }
  if (!leech) return null
  return (
    <div className="card-note leech">
      <p className="small">Diese Karte hast du schon <b>{s.lapses}×</b> vergessen. Eine eigene Merkhilfe hilft beim Behalten.</p>
      <button onClick={onEdit}>+ Merkhilfe schreiben</button>
    </div>
  )
}

/** Unten auf der Kartenrückseite: „+ Merkhilfe“, solange es keine gibt (hartnäckige Karten: siehe CardNote) */
export function NoteButton({ cardId, onEdit }: { cardId: string; onEdit: () => void }) {
  const s = useNoteState(cardId)
  if (!s || s.text || s.lapses >= LEECH_LAPSES) return null
  return <button className="note-add" onClick={onEdit}>+ Merkhilfe</button>
}

/** Merkhilfe bearbeiten über der Lernsession (eigener Verlaufseintrag – Zurück schließt) */
export function NoteSheet({ cardId, title, onClose }: { cardId: string; title?: string; onClose: () => void }) {
  const s = useNoteState(cardId)
  return (
    <div className="note-sheet" role="dialog" aria-label="Merkhilfe bearbeiten">
      <div className="note-sheet-inner">
        <h2>Merkhilfe</h2>
        {title && <p className="muted small">{title}</p>}
        {s && <NoteForm cardId={cardId} initial={s.text} onDone={onClose} />}
      </div>
    </div>
  )
}

/** Auf Detail- und Statistik-Seite: Merkhilfe anzeigen und direkt bearbeiten */
export function InlineNote({ cardId }: { cardId: string }) {
  const s = useNoteState(cardId)
  const [editing, setEditing] = useState(false)
  if (!s) return null
  if (editing) return <NoteForm cardId={cardId} initial={s.text} onDone={() => setEditing(false)} />
  const leech = s.lapses >= LEECH_LAPSES
  return (
    <div className={`inline-note${leech && !s.text ? ' leech' : ''}`}>
      {s.text
        ? <p className="note-text">💡 {s.text}</p>
        : leech
          ? <p className="small">Schon <b>{s.lapses}×</b> vergessen – eine eigene Merkhilfe hilft beim Behalten.</p>
          : <p className="muted small">Noch keine Merkhilfe.</p>}
      <button onClick={() => setEditing(true)}>{s.text ? 'Bearbeiten' : '+ Merkhilfe'}</button>
    </div>
  )
}
