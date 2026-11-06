/**
 * Merkhilfen: eigene Notiz je Karte – steht bei jeder Wiederholung auf der Rückseite (vorne würde sie die
 * Antwort verraten) und auf der Detailseite. Bleiben beim Löschen des Fortschritts erhalten; im Backup.
 */
import { db, type DeckDB, type NoteRecord } from '../data/db'

export const NOTE_MAX_LENGTH = 300

export async function getNote(cardId: string, database: DeckDB = db): Promise<NoteRecord | undefined> {
  return database.notes.get(cardId)
}

/** Speichert die Merkhilfe; leer = löschen. Gibt den gespeicherten Text zurück (gekürzt auf die Höchstlänge). */
export async function saveNote(cardId: string, text: string, now = Date.now(), database: DeckDB = db): Promise<string> {
  const clean = text.replace(/\r\n?/g, '\n').trim().slice(0, NOTE_MAX_LENGTH)
  if (!clean) {
    await database.notes.delete(cardId)
    return ''
  }
  await database.notes.put({ id: cardId, text: clean, updatedAt: now })
  return clean
}
