/**
 * Überleben: 3 Leben, alle Quiz-Fragetypen gemischt. 15 s pro Frage, alle 5 Fragen 1 s weniger (bis 6 s);
 * falsch oder Zeit abgelaufen kostet ein Leben. Highscore = überlebte (richtig beantwortete) Fragen.
 */
import type { CounterCard, ItemCard, QuizKind } from '../data/model'
import { buildRound, type QuizQuestion, type Rng } from '../quiz/quiz'

export const LIVES = 3
export const START_SECONDS = 15
export const MIN_SECONDS = 6
/** Alle 5 Fragen 1 s weniger */
export const FASTER_EVERY = 5
/** Souls je überlebte Frage */
export const SURVIVAL_SOULS_PER_QUESTION = 10
/** Fragen werden in Paketen erzeugt (jedes Item höchstens einmal je Paket) */
export const BATCH_SIZE = 30

/** Sekunden für die Frage mit Index `index` (ab 0): 15 s, alle 5 Fragen 1 s weniger, mindestens 6 s */
export function secondsFor(index: number): number {
  return Math.max(MIN_SECONDS, START_SECONDS - Math.floor(index / FASTER_EVERY))
}

export function survivalBatch(
  items: readonly ItemCard[],
  kinds: readonly QuizKind[],
  extra: { counters?: readonly CounterCard[]; items?: ReadonlyMap<string, ItemCard> } = {},
  rng: Rng = Math.random,
): QuizQuestion[] {
  return buildRound(items, kinds, rng, BATCH_SIZE, extra)
}

export interface SurvivalState {
  /** Index der aktuellen Frage */
  index: number
  lives: number
  /** Richtig beantwortete Fragen */
  score: number
  /** Antwort auf die aktuelle Frage (−1 = Zeit abgelaufen), null = noch offen */
  picked: number | null
  over: boolean
}

export const TIMEOUT = -1

export function startSurvival(): SurvivalState {
  return { index: 0, lives: LIVES, score: 0, picked: null, over: false }
}

/** Antwort (oder Zeitablauf) auf die aktuelle Frage */
export function answerSurvival(state: SurvivalState, question: Pick<QuizQuestion, 'answer'>, picked: number): SurvivalState {
  if (state.picked !== null || state.over) return state
  const correct = picked === question.answer
  const lives = correct ? state.lives : state.lives - 1
  return { ...state, picked, lives, score: state.score + (correct ? 1 : 0), over: lives <= 0 }
}

/** Weiter zur nächsten Frage (nur nach einer Antwort und solange Leben übrig sind) */
export function nextSurvival(state: SurvivalState): SurvivalState {
  if (state.picked === null || state.over) return state
  return { ...state, index: state.index + 1, picked: null }
}

/** Ablauf einer Runde mit Zeit je Frage – reine Funktion für useReducer */
export interface SurvivalRun extends SurvivalState {
  /** Falsch beantwortete Fragen (Index, Antwort bzw. TIMEOUT) – für „Zum Merken“ */
  misses: { index: number; picked: number }[]
  /** Zeitpunkt (performance.now), seit dem die aktuelle Frage sichtbar ist */
  shownAt: number
  /** Zeit im Hintergrund (zählt nicht) */
  pausedMs: number
  /** App gerade im Hintergrund seit … */
  hiddenAt: number | null
  now: number
}

export type SurvivalAction =
  | { type: 'tick'; now: number }
  | { type: 'answer'; picked: number; answer: number; now: number }
  | { type: 'next'; now: number }
  | { type: 'hide'; now: number }
  | { type: 'show'; now: number }

export function startRun(now: number): SurvivalRun {
  return { ...startSurvival(), misses: [], shownAt: now, pausedMs: 0, hiddenAt: null, now }
}

function applyAnswer(run: SurvivalRun, answer: number, picked: number, now: number): SurvivalRun {
  const next: SurvivalRun = { ...run, ...answerSurvival(run, { answer }, picked), now }
  return picked === answer ? next : { ...next, misses: [...run.misses, { index: run.index, picked }] }
}

/** Verbleibende Zeit für die aktuelle Frage (ms) */
export function timeLeft(run: SurvivalRun): number {
  const elapsed = (run.hiddenAt ?? run.now) - run.shownAt - run.pausedMs
  return Math.max(0, secondsFor(run.index) * 1000 - elapsed)
}

export function survivalReducer(run: SurvivalRun, action: SurvivalAction): SurvivalRun {
  switch (action.type) {
    case 'tick': {
      const next = { ...run, now: action.now }
      // Zeit abgelaufen (nicht im Hintergrund) = falsche Antwort
      if (run.picked === null && !run.over && run.hiddenAt === null && timeLeft(next) <= 0) {
        return applyAnswer(next, Number.NaN, TIMEOUT, action.now)
      }
      return next
    }
    case 'answer':
      if (run.picked !== null || run.over || timeLeft({ ...run, now: action.now }) <= 0) return run
      return applyAnswer(run, action.answer, action.picked, action.now)
    case 'next': {
      const next = nextSurvival(run)
      return next === run ? run : { ...run, ...next, shownAt: action.now, pausedMs: 0, now: action.now }
    }
    case 'hide':
      return run.hiddenAt === null ? { ...run, hiddenAt: action.now } : run
    case 'show':
      return run.hiddenAt === null ? run : { ...run, pausedMs: run.pausedMs + (action.now - run.hiddenAt), hiddenAt: null, now: action.now }
  }
}
