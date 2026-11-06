/**
 * Antwort eintippen (Items, Counter): tolerant prüfen.
 * - Groß/Klein, Leerzeichen, Bindestriche und Satzzeichen sind egal
 * - kleine Tippfehler zählen als richtig (bis 6 Zeichen 1, länger 2 Fehler; ganz kurze Namen exakt)
 * - ein eindeutiger Anfang ab 4 Buchstaben reicht („headh“ → Headhunter)
 * - ein anderer echter Name ist nie richtig, auch wenn er ähnlich aussieht
 */
export const MIN_PREFIX = 4

/** „High-Velocity Rounds“ → „highvelocityrounds“ */
export function normalizeName(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '')
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = row
  }
  return prev[b.length]
}

function typoLimit(length: number): number {
  if (length <= 3) return 0
  return length <= 6 ? 1 : 2
}

export interface AnswerCheck {
  correct: boolean
  /** Index der getroffenen Antwort in `answers` (Counter: welches der Top-3-Items) */
  match?: number
}

/**
 * Prüft eine eingetippte Antwort. `answers`: die richtigen Namen; `allNames`: alle Namen, die man meinen könnte
 * (z. B. alle Items) – für „eindeutiger Anfang“ und damit ein anderer echter Name nicht als Tippfehler durchgeht.
 */
export function checkAnswer(input: string, answers: readonly string[], allNames: readonly string[]): AnswerCheck {
  const typed = normalizeName(input)
  if (!typed) return { correct: false }
  const right = answers.map(normalizeName)
  const exact = right.indexOf(typed)
  if (exact >= 0) return { correct: true, match: exact }
  const known = new Set([...allNames.map(normalizeName), ...right])
  if (known.has(typed)) return { correct: false }
  const typo = right.findIndex(a => levenshtein(typed, a) <= typoLimit(a.length))
  if (typo >= 0) return { correct: true, match: typo }
  if (typed.length >= MIN_PREFIX) {
    const starting = [...known].filter(n => n.startsWith(typed))
    if (starting.length > 0 && starting.every(n => right.includes(n))) return { correct: true, match: right.indexOf(starting[0]) }
  }
  return { correct: false }
}
