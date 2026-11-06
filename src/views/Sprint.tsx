import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { SoulsEarned, UnlearnedTag } from '../components/QuizParts'
import { db, getMeta, getSettings, getSprintHighscores, setMeta, submitSprintScore } from '../data/db'
import { LEARNED_ONLY_MIN, QUIZ_SCOPE_LABEL } from '../data/model'
import { vibrate } from '../game/effects'
import { finishRound } from '../game/missions'
import type { RoundAward } from '../game/souls'
import { logMistake } from '../game/weakness'
import { loadLearnedCards } from '../quiz/load'
import {
  clockLeft, clockReducer, learnedCount, nextSprintQuestion, poolKinds, SPRINT_KIND_LABEL, SPRINT_MS, SPRINT_POOL_LABEL, SPRINT_POOLS,
  SPRINT_SOULS_PER_CORRECT, sprintKinds, startClock, type SprintAnswer, type SprintCards, type SprintKind, type SprintPool, type SprintQuestion,
} from '../sprint/sprint'
import { requestLearn } from '../srs/srs'

interface Props {
  onExit: () => void
}

interface Result {
  pool: SprintPool
  answers: SprintAnswer[]
  correct: number
  newBest: boolean
  earned: RoundAward
}

type Phase = { name: 'start' } | { name: 'run'; no: number } | { name: 'result'; result: Result }

const RULES: Record<SprintPool, string> = {
  all: 'Items, Fähigkeiten und Heroes',
  items: 'Items',
  abilities: 'Fähigkeiten',
  heroes: 'Heroes',
}

async function loadCards(): Promise<SprintCards> {
  const settings = await getSettings()
  const [items, abilities, heroes, known] = await Promise.all([db.items.toArray(), db.abilities.toArray(), db.heroes.toArray(), loadLearnedCards()])
  // Item-Kategorien und was gefragt wird wie im Quiz (Einstellungen)
  return { items: items.filter(i => settings.slots.includes(i.slot)), abilities, heroes, known, scope: settings.quizScope }
}

/** Mehrzahl der Sorten für Hinweise („10 gelernte Items“) */
const KIND_PLURAL: Record<SprintKind, string> = { item: 'Items', ability: 'Fähigkeiten', hero: 'Heroes' }

function formatSeconds(ms: number): string {
  const s = Math.ceil(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function Stage({ question }: { question: SprintQuestion }) {
  return (
    <div className={`sprint-stage kind-${question.kind}${question.slot ? ` slot-bg-${question.slot}` : ''}`}>
      <img src={question.image} alt={`${SPRINT_KIND_LABEL[question.kind]}-Bild`} draggable={false} />
      <span className="guess-kind">{SPRINT_KIND_LABEL[question.kind]}</span>
      {question.unlearned && <UnlearnedTag />}
    </div>
  )
}

/** Eine laufende Runde: 60 s, falsch kostet 3 s, Pause im Hintergrund */
function SprintRun({ cards, pool, onDone, onCancel }: {
  cards: SprintCards
  pool: SprintPool
  onDone: (answers: SprintAnswer[]) => void
  onCancel: () => void
}) {
  const [used] = useState(() => new Set<string>())
  const [pair, setPair] = useState(() => [nextSprintQuestion(cards, pool, used), nextSprintQuestion(cards, pool, used)])
  const [answers, setAnswers] = useState<SprintAnswer[]>([])
  const [feedback, setFeedback] = useState<number | null>(null)
  const [clock, dispatch] = useReducer(clockReducer, undefined, () => startClock(performance.now()))
  const advanceTimer = useRef<number | undefined>(undefined)
  const finished = useRef(false)
  const question = pair[0]
  const wrong = answers.filter(a => a.picked !== a.question.answer).length
  const correct = answers.length - wrong
  const left = clockLeft(clock, wrong)
  const over = left <= 0

  // Uhr; im Hintergrund (Anruf, App gewechselt) läuft die Zeit nicht weiter
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

  // Bild der übernächsten Frage vorladen
  useEffect(() => {
    if (pair[1]?.image) new Image().src = pair[1].image
  }, [pair])

  useEffect(() => {
    if (!over || finished.current) return
    finished.current = true
    window.clearTimeout(advanceTimer.current)
    onDone(answers)
  }, [over, answers, onDone])

  const pick = useCallback((choice: number) => {
    if (!question || feedback !== null || over) return
    const isRight = choice === question.answer
    setAnswers(a => [...a, { question, picked: choice }])
    setFeedback(choice)
    if (!isRight) {
      vibrate()
      // noch ungelernte Karten zählen nicht als Schwäche
      if (!question.unlearned) void logMistake(question.cardId, 'sprint')
    }
    advanceTimer.current = window.setTimeout(() => {
      const fresh = nextSprintQuestion(cards, pool, used)
      setPair(([, upcoming]) => [upcoming, fresh])
      setFeedback(null)
    }, isRight ? 180 : 650)
  }, [question, feedback, over, cards, pool, used])

  // Tastatur: 1–4 = antworten, Esc = abbrechen
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel()
      else if (['1', '2', '3', '4'].includes(e.key)) pick(Number(e.key) - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pick, onCancel])

  if (!question) return <div className="center muted">Keine Fragen möglich.</div>

  return (
    <div className="sprint">
      <header className="learn-bar">
        <button className="icon-btn" onClick={onCancel} aria-label="Abbrechen">✕</button>
        <div className="goal">
          <div className={`goal-bar sprint-bar${left < 10_000 ? ' low' : ''}`}><div style={{ width: `${(left / SPRINT_MS) * 100}%` }} /></div>
          <span className="small sprint-time">
            <span className={left < 10_000 ? 'error' : 'muted'} aria-live="off">{formatSeconds(left)}</span>
            {wrong > 0 && <span key={wrong} className="sprint-penalty">−3 s</span>}
          </span>
        </div>
        <span className="quiz-score" aria-label={`${correct} richtig`}>✓ {correct}</span>
      </header>

      <Stage question={question} />

      <div className="options sprint-options">
        {question.options.map((option, i) => {
          const state = feedback === null ? '' : i === question.answer ? ' correct' : i === feedback ? ' wrong' : ' dim'
          return (
            <button key={`${answers.length}-${i}`} className={`option${state}`} disabled={feedback !== null} onClick={() => pick(i)}>
              <span className="option-key">{i + 1}</span>
              <span>{option}</span>
            </button>
          )
        })}
      </div>
      <p className="muted small center-text sprint-hint">
        {feedback !== null && feedback !== question.answer
          ? <span className="error">Richtig: {question.options[question.answer]}{question.detail ? ` · ${question.detail}` : ''}</span>
          : 'Falsch kostet 3 Sekunden'}
      </p>
    </div>
  )
}

function ResultView({ result, best, onAgain, onExit }: { result: Result; best: number; onAgain: () => void; onExit: () => void }) {
  const mistakes = result.answers.filter(a => a.picked !== a.question.answer)
  // jede Karte einmal
  const unique = [...new Map(mistakes.map(m => [m.question.cardId, m])).values()]
  const [learned, setLearned] = useState(false)

  async function learnMistakes() {
    for (const m of unique) await requestLearn(m.question.cardId)
    setLearned(true)
  }

  return (
    <div className="quiz-result">
      <h2>Zeit um!</h2>
      <div className="result-score">
        <div className="big">{result.correct}</div>
        <div className="muted small">richtig</div>
        <div className="big">{mistakes.length}</div>
        <div className="muted small">falsch (je −3 s)</div>
      </div>
      {result.newBest
        ? <p className="good center-text">Neuer Highscore ({SPRINT_POOL_LABEL[result.pool]})! 🎉</p>
        : <p className="muted small center-text">Highscore ({SPRINT_POOL_LABEL[result.pool]}): {best}</p>}
      <SoulsEarned earned={result.earned} />

      {unique.length > 0 && (
        <div className="panel">
          <h2>Vertan bei</h2>
          <ul className="mistakes">
            {unique.map(({ question: q, picked }) => (
              <li key={q.cardId}>
                <span className={`sprint-thumb kind-${q.kind}${q.slot ? ` slot-bg-${q.slot}` : ''}`}><img src={q.image} alt="" /></span>
                <div>
                  <div>{q.unlearned && <UnlearnedTag />}<b>{q.options[q.answer]}</b>{q.detail && <span className="muted small"> · {q.detail}</span>}</div>
                  <div className="small error">du: {q.options[picked]}</div>
                </div>
              </li>
            ))}
          </ul>
          {learned
            ? <p className="good small">Vorgemerkt – kommen in der nächsten Session ihres Decks dran.</p>
            : <button onClick={() => void learnMistakes()}>Fehler lernen ({unique.length})</button>}
        </div>
      )}

      <div className="result-actions">
        <button className="primary" onClick={onAgain}>Nochmal</button>
        <button onClick={onExit}>Zurück</button>
      </div>
    </div>
  )
}

export function Sprint({ onExit }: Props) {
  const cards = useLiveQuery(loadCards, [])
  const bests = useLiveQuery(() => getSprintHighscores(), [])
  const [pool, setPool] = useState<SprintPool | null>(null)
  useEffect(() => { void getMeta<SprintPool>('sprintPool', 'all').then(setPool) }, [])
  const [phase, setPhase] = useState<Phase>({ name: 'start' })
  const runs = useRef(0)

  const toStart = useCallback(() => setPhase({ name: 'start' }), [])
  const start = useCallback(() => setPhase({ name: 'run', no: ++runs.current }), [])

  const finish = useCallback(async (answers: SprintAnswer[]) => {
    if (!pool) return
    const correct = answers.filter(a => a.picked === a.question.answer).length
    const newBest = await submitSprintScore(pool, correct)
    // Souls: +5 je richtige Antwort (ab der 4. Runde des Tages ¼) – Ergebnis zählt für die Tagesmissionen
    const earned = await finishRound('sprint', correct * SPRINT_SOULS_PER_CORRECT, {
      score: correct, wrong: answers.length - correct, pool,
    })
    setPhase({ name: 'result', result: { pool, answers, correct, newBest, earned } })
  }, [pool])

  const available = cards && pool ? sprintKinds(cards, pool).length > 0 : false
  // Esc: Start → zurück, Ergebnis → Start (in der Runde: abbrechen, siehe SprintRun)
  useEffect(() => {
    if (phase.name === 'run') return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onExit()
      else if (e.key === 'Enter' && phase.name === 'start' && available && !(e.target instanceof HTMLButtonElement)) start()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase.name, onExit, start, available])

  if (!cards || !bests || !pool) return <div className="center muted">Lade…</div>

  if (phase.name === 'run') {
    return <SprintRun key={phase.no} cards={cards} pool={pool} onDone={answers => void finish(answers)} onCancel={toStart} />
  }

  if (phase.name === 'result') {
    return <ResultView result={phase.result} best={bests[phase.result.pool] ?? 0} onAgain={start} onExit={onExit} />
  }

  const scope = cards.scope ?? 'all'
  // „Nur Gelerntes“: welche Sorten noch zu wenige gelernte Karten haben
  const short = scope === 'learned-only' ? poolKinds(pool).filter(k => learnedCount(cards, k) < LEARNED_ONLY_MIN) : []
  const hasData = sprintKinds({ ...cards, scope: 'all' }, pool).length > 0
  return (
    <div className="sprint-page">
      <header className="home-head">
        <button className="icon-btn" onClick={onExit} aria-label="Zurück">←</button>
        <h1>Sprint</h1>
        <span className="icon-btn" aria-hidden="true" />
      </header>
      <div className="segmented four" role="tablist" aria-label="Auswahl">
        {SPRINT_POOLS.map(p => (
          <button key={p} role="tab" aria-selected={p === pool} className={p === pool ? 'on' : ''}
            onClick={() => { setPool(p); void setMeta('sprintPool', p) }}>
            {SPRINT_POOL_LABEL[p]}
          </button>
        ))}
      </div>
      <div className="panel sprint-intro">
        <div className="big">{bests[pool] ?? 0}</div>
        <div className="muted small">Highscore ({SPRINT_POOL_LABEL[pool]})</div>
        <p className="small">
          60 Sekunden: Erkenne so viele {RULES[pool]} wie möglich am Bild. Jede falsche Antwort kostet 3 Sekunden.
        </p>
        <p className="muted small">
          Gefragt wird: {QUIZ_SCOPE_LABEL[scope]}
          {available && short.length > 0 && ` – ohne ${short.map(k => KIND_PLURAL[k]).join(' und ')} (noch keine ${LEARNED_ONLY_MIN} gelernt)`}
        </p>
      </div>
      {available
        ? <button className="primary" onClick={start}>Start</button>
        : hasData
          ? (
            <p className="muted">
              Eingestellt ist „Nur Gelerntes“: Der Sprint braucht mindestens {LEARNED_ONLY_MIN} gelernte{' '}
              {short.map(k => `${KIND_PLURAL[k]} (du hast ${learnedCount(cards, k)})`).join(' oder ')}, sonst kommen ständig dieselben.
              Lerne noch ein paar Karten oder stell in den Einstellungen „Gelerntes zuerst“ ein.
            </p>
          )
          : <p className="muted">Für diese Auswahl gibt es noch keine Daten – einmal mit Internet öffnen.</p>}
    </div>
  )
}
