import { useEffect, useRef, useState } from 'react'

/** Antwort eintippen statt „Tippen zum Umdrehen“: Prüfen (Enter) oder „Weiß nicht“ */
export function AnswerInput({ placeholder, onSubmit, onGiveUp }: {
  placeholder: string
  onSubmit: (text: string) => void
  onGiveUp: () => void
}) {
  const [text, setText] = useState('')
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { ref.current?.focus({ preventScroll: true }) }, [])
  return (
    <form
      className="answer-form"
      onSubmit={e => {
        e.preventDefault()
        if (text.trim()) onSubmit(text)
      }}
    >
      <input
        ref={ref}
        value={text}
        placeholder={placeholder}
        aria-label="Antwort"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        enterKeyHint="done"
        onChange={e => setText(e.target.value)}
        // Tasten gehören dem Feld (Leertaste dreht die Karte nicht um); Enter schickt das Formular ab
        onKeyDown={e => e.stopPropagation()}
      />
      <div className="answer-actions">
        <button type="submit" className="primary" disabled={!text.trim()}>Prüfen</button>
        <button type="button" onClick={onGiveUp}>Weiß nicht</button>
      </div>
    </form>
  )
}

export interface TypedAnswer {
  /** Eingetippt („“ = „Weiß nicht“) */
  text: string
  correct: boolean
  /** Getroffene Antwort (Name) */
  matched?: string
  /** …und ihre Item-ID (Counter: wird auf der Rückseite markiert) */
  matchedId?: string
}

/** Oben auf der Rückseite: Ergebnis der Eingabe */
export function TypedResult({ typed, answers }: { typed: TypedAnswer; answers: readonly string[] }) {
  if (typed.correct) {
    return (
      <div className="typed-result good-box">
        <b>✓ Richtig{typed.matched ? `: ${typed.matched}` : ''}</b>
        {typed.matched && typed.text.trim().toLowerCase() !== typed.matched.toLowerCase() && (
          <span className="muted small"> (du: „{typed.text.trim()}“)</span>
        )}
      </div>
    )
  }
  return (
    <div className="typed-result bad-box">
      <b>{typed.text ? `✗ Du: „${typed.text.trim()}“` : '✗ Nicht gewusst'}</b>
      <span className="small"> · richtig: {answers.length > 1 ? `eins von ${answers.join(', ')}` : answers[0]}</span>
    </div>
  )
}
