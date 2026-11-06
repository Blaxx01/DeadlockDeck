import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { QuestionMedia, QuizOptions, SoulsEarned } from '../components/QuizParts'
import { db, getSettings, getSurvivalHighscore, submitSurvivalScore } from '../data/db'
import type { CounterCard, ItemCard, QuizKind } from '../data/model'
import { vibrate } from '../game/effects'
import { finishRound } from '../game/missions'
import type { RoundAward } from '../game/souls'
import { logMistake } from '../game/weakness'
import { itemInfo, plainText } from '../quiz/format'
import type { QuizQuestion } from '../quiz/quiz'
import {
  FASTER_EVERY, LIVES, MIN_SECONDS, secondsFor, START_SECONDS, startRun, survivalBatch, survivalReducer,
  SURVIVAL_SOULS_PER_QUESTION, timeLeft, TIMEOUT,
} from '../survival/survival'

interface Props {
  onExit: () => void
}

interface Pool {
  items: ItemCard[]
  kinds: QuizKind[]
  counters: CounterCard[]
  all: Map<string, ItemCard>
}

interface Mistake {
  question: QuizQuestion
  picked: number
}

interface Result {
  score: number
  mistakes: Mistake[]
  newBest: boolean
  earned: RoundAward
}

type Phase = { name: 'start' } | { name: 'run'; no: number } | { name: 'result'; result: Result }

async function loadPool(): Promise<Pool> {
  const settings = await getSettings()
  const [all, counters] = await Promise.all([db.items.toArray(), db.counters.toArray()])
  // Kategorien und Fragetypen wie im Quiz (Einstellungen)
  return { items: all.filter(i => settings.slots.includes(i.slot)), kinds: settings.quizKinds, counters, all: new Map(all.map(i => [i.id, i])) }
}

function makeBatch(pool: Pool): QuizQuestion[] {
  return survivalBatch(pool.items, pool.kinds, { counters: pool.counters, items: pool.all })
}

function Lives({ lives }: { lives: number }) {
  return (
    <span className="lives" role="img" aria-label={`${lives} von ${LIVES} Leben`}>
      {Array.from({ length: LIVES }, (_, i) => <span key={i} className={i < lives ? 'on' : 'off'}>♥</span>)}
    </span>
  )
}

/** Eine Runde: Fragen nacheinander, Zeit je Frage, 3 Leben */
function SurvivalRunView({ pool, onDone, onCancel }: { pool: Pool; onDone: (score: number, mistakes: Mistake[]) => void; onCancel: () => void }) {
  const [questions, setQuestions] = useState(() => makeBatch(pool))
  const [run, dispatch] = useReducer(survivalReducer, undefined, () => startRun(performance.now()))
  const advanceTimer = useRef<number | undefined>(undefined)
  /** Frage, deren Fehler schon gemerkt wurde (Effekte können doppelt laufen) */
  const handled = useRef(-1)
  const question = questions[run.index] as QuizQuestion | undefined
  const left = timeLeft(run)
  const total = secondsFor(run.index) * 1000
  const answered = run.picked !== null
  const correct = answered && question !== undefined && run.picked === question.answer

  // Uhr und Pause im Hintergrund
  useEffect(() => {
    const id = window.setInterval(() => dispatch({ type: 'tick', now: performance.now() }), 100)
    const onVisible = () => dispatch({ type: document.visibilityState === 'hidden' ? 'hide' : 'show', now: performance.now() })
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(id)
      window.clearTimeout(advanceTimer.current)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  // Bilder der nächsten Fragen vorladen
  useEffect(() => {
    for (const q of questions.slice(run.index + 1, run.index + 3)) {
      const src = q.image ?? q.portrait ?? (q.subjectId ? pool.all.get(q.subjectId)?.image : undefined)
      if (src) new Image().src = src
    }
  }, [questions, run.index, pool.all])

  const goNext = useCallback(() => {
    // rechtzeitig neue Fragen anhängen
    if (run.index + 3 >= questions.length) {
      const more = makeBatch(pool)
      setQuestions(qs => [...qs, ...more])
    }
    dispatch({ type: 'next', now: performance.now() })
  }, [run.index, questions.length, pool])

  // Falsch oder Zeit abgelaufen: als Schwäche merken und vibrieren (einmal je Frage)
  useEffect(() => {
    if (!answered || correct || !question || handled.current === run.index) return
    handled.current = run.index
    vibrate()
    void logMistake(question.cardId ?? question.itemId, 'survival')
  }, [answered, correct, question, run.index])

  // Richtig: kurz zeigen, dann von selbst weiter
  useEffect(() => {
    if (!correct) return
    advanceTimer.current = window.setTimeout(goNext, 650)
    return () => window.clearTimeout(advanceTimer.current)
  }, [correct, goNext])

  const finish = useCallback(() => {
    onDone(run.score, run.misses.map(m => ({ question: questions[m.index], picked: m.picked })))
  }, [onDone, run.score, run.misses, questions])

  const pick = useCallback((choice: number) => {
    if (!question) return
    dispatch({ type: 'answer', picked: choice, answer: question.answer, now: performance.now() })
  }, [question])

  // Tastatur: 1–4 = antworten, Enter = weiter, Esc = abbrechen
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') return onCancel()
      if (!answered && ['1', '2', '3', '4'].includes(e.key)) pick(Number(e.key) - 1)
      else if (answered && !correct && e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) {
        if (run.over) finish()
        else goNext()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [answered, correct, pick, goNext, finish, run.over, onCancel])

  if (!question) return <div className="center muted">Keine Fragen möglich.</div>

  return (
    <div className="quiz survival">
      <header className="learn-bar">
        <button className="icon-btn" onClick={onCancel} aria-label="Abbrechen">✕</button>
        <Lives lives={run.lives} />
        <div className="goal">
          <div className={`goal-bar survival-bar${left <= 3000 && !answered ? ' low' : ''}`}>
            <div style={{ width: `${answered ? 0 : (left / total) * 100}%` }} />
          </div>
          <span className="muted small">Frage {run.index + 1} · {Math.ceil(left / 1000)} s</span>
        </div>
        <span className="quiz-score" aria-label={`${run.score} überlebt`}>✓ {run.score}</span>
      </header>

      <div className="quiz-media">
        <QuestionMedia question={question} subject={question.subjectId ? pool.all.get(question.subjectId) : undefined} />
      </div>

      <p className="quiz-prompt">{question.prompt}</p>

      <QuizOptions question={question} picked={run.picked} onPick={pick} keyPrefix={String(run.index)} />

      <div className="quiz-footer">
        {answered && correct && <p className="good">Richtig!</p>}
        {answered && !correct && (
          <>
            <p className="error">
              {run.picked === TIMEOUT ? 'Zeit abgelaufen' : 'Falsch'} – richtig: {question.options[question.answer]}
              {run.over ? ' · keine Leben mehr' : ` · noch ${run.lives} Leben`}
            </p>
            <p className="muted small">{question.info ?? itemInfo(pool.all.get(question.itemId))}</p>
            <button className="primary" autoFocus onClick={run.over ? finish : goNext}>{run.over ? 'Ergebnis' : 'Weiter'}</button>
          </>
        )}
        {!answered && <p className="muted small center-text">Alle {FASTER_EVERY} Fragen 1 Sekunde weniger</p>}
      </div>
    </div>
  )
}

export function Survival({ onExit }: Props) {
  const pool = useLiveQuery(loadPool, [])
  const best = useLiveQuery(() => getSurvivalHighscore(), [])
  const [phase, setPhase] = useState<Phase>({ name: 'start' })
  const runs = useRef(0)
  const toStart = useCallback(() => setPhase({ name: 'start' }), [])
  const start = useCallback(() => setPhase({ name: 'run', no: ++runs.current }), [])

  const finish = useCallback(async (score: number, mistakes: Mistake[]) => {
    const newBest = await submitSurvivalScore(score)
    // Souls: +10 je überlebte Frage (ab der 4. Runde des Tages ¼) – Ergebnis zählt für die Tagesmissionen
    const earned = await finishRound('survival', score * SURVIVAL_SOULS_PER_QUESTION, { score })
    setPhase({ name: 'result', result: { score, mistakes, newBest, earned } })
  }, [])

  useEffect(() => {
    if (phase.name === 'run') return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onExit()
      else if (e.key === 'Enter' && phase.name === 'start' && !(e.target instanceof HTMLButtonElement)) start()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase.name, onExit, start])

  if (!pool || best === undefined) return <div className="center muted">Lade…</div>
  const possible = hasQuestions(pool)

  if (phase.name === 'run') {
    return <SurvivalRunView key={phase.no} pool={pool} onDone={(score, mistakes) => void finish(score, mistakes)} onCancel={toStart} />
  }

  if (phase.name === 'result') {
    const { result } = phase
    return (
      <div className="quiz-result">
        <h2>Keine Leben mehr</h2>
        <div className="result-score">
          <div className="big">{result.score}</div>
          <div className="muted small">{result.score === 1 ? 'Frage' : 'Fragen'} überlebt</div>
          <div className="big">{secondsFor(result.score + result.mistakes.length - 1)} s</div>
          <div className="muted small">Zeit pro Frage am Ende</div>
        </div>
        {result.newBest
          ? <p className="good center-text">Neuer Highscore! 🎉</p>
          : <p className="muted small center-text">Highscore: {best}</p>}
        <SoulsEarned earned={result.earned} />
        {result.mistakes.length > 0 && (
          <div className="panel">
            <h2>Zum Merken</h2>
            <ul className="mistakes">
              {result.mistakes.map(({ question: q, picked }, i) => {
                const item = pool.all.get(q.itemId)
                return (
                  <li key={`${q.itemId}-${i}`}>
                    {item?.image && <img src={item.image} alt="" />}
                    <div>
                      <div className="muted small">{q.kind === 'description' && q.html ? `„${plainText(q.html)}“` : q.prompt}</div>
                      <div>Richtig: <b>{q.options[q.answer]}</b></div>
                      <div className="small error">{picked === TIMEOUT ? 'Zeit abgelaufen' : `Deine Antwort: ${q.options[picked]}`}</div>
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>
        )}
        <div className="result-actions">
          <button className="primary" onClick={start}>Nochmal</button>
          <button onClick={onExit}>Zurück</button>
        </div>
      </div>
    )
  }

  return (
    <div className="sprint-page">
      <header className="home-head">
        <button className="icon-btn" onClick={onExit} aria-label="Zurück">←</button>
        <h1>Überleben</h1>
        <span className="icon-btn" aria-hidden="true" />
      </header>
      <div className="panel sprint-intro">
        <div className="big">{best}</div>
        <div className="muted small">Highscore (überlebte Fragen)</div>
        <ul className="survival-rules small">
          <li><Lives lives={LIVES} /> {LIVES} Leben – falsch oder Zeit abgelaufen kostet eins</li>
          <li>{START_SECONDS} s pro Frage, alle {FASTER_EVERY} Fragen 1 s weniger (bis {MIN_SECONDS} s)</li>
          <li>Alle Quiz-Fragetypen gemischt (Auswahl wie im Quiz, siehe Einstellungen)</li>
        </ul>
      </div>
      {possible
        ? <button className="primary" onClick={start}>Start</button>
        : <p className="muted">Für die gewählten Kategorien und Fragetypen gibt es zu wenige Items. Ändere die Auswahl in den Einstellungen.</p>}
    </div>
  )
}

/** Gibt es überhaupt Fragen? (z. B. zu wenige Items in den gewählten Kategorien) */
function hasQuestions(pool: Pool): boolean {
  return pool.items.length >= 4 && pool.kinds.length > 0
}
