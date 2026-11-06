import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { db, getQuizHighscore, getSettings, submitQuizScore } from '../data/db'
import { SLOT_LABEL, type ItemCard } from '../data/model'
import { sanitizeHtml } from '../data/sanitize'
import { buildRound, ROUND_SIZE, scoreAnswer, type QuizQuestion } from '../quiz/quiz'

interface Props {
  onExit: () => void
}

interface Answer {
  question: QuizQuestion
  picked: number
  points: number
}

type Phase = 'loading' | 'empty' | 'playing' | 'done'

function itemInfo(card: ItemCard | undefined): string {
  if (!card) return ''
  const parts = [card.name, SLOT_LABEL[card.slot], `Tier ${card.tier}`]
  if (card.cost) parts.push(`${card.cost.toLocaleString('de-DE')} Souls`)
  const cd = card.timings.find(t => t.kind === 'cooldown')
  if (cd) parts.push(`Cooldown ${cd.value}`)
  return parts.join(' · ')
}

function plainText(html: string, max = 90): string {
  const text = html.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

function QuestionMedia({ question, subject }: { question: QuizQuestion; subject?: ItemCard }) {
  const html = useMemo(() => (question.html ? sanitizeHtml(question.html) : ''), [question.html])
  if (question.kind === 'image' && question.image) {
    return <img className="quiz-image" src={question.image} alt="Item-Bild" draggable={false} />
  }
  if (question.portrait) {
    return <img className="quiz-portrait" src={question.portrait} alt="" draggable={false} />
  }
  if (question.kind === 'description') {
    return (
      <div className="quiz-desc">
        <div className="desc" dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    )
  }
  if (subject?.image) {
    return <img className="quiz-subject" src={subject.image} alt={subject.name} draggable={false} />
  }
  return null
}

export function Quiz({ onExit }: Props) {
  const [round, setRound] = useState(0)
  const [phase, setPhase] = useState<Phase>('loading')
  const [cards, setCards] = useState<Map<string, ItemCard>>(new Map())
  const [questions, setQuestions] = useState<QuizQuestion[]>([])
  const [index, setIndex] = useState(0)
  const [answers, setAnswers] = useState<Answer[]>([])
  const [highscore, setHighscore] = useState(0)
  const [isNewHighscore, setIsNewHighscore] = useState(false)
  const shownAt = useRef(0)
  const finishing = useRef(false)

  useEffect(() => {
    const ctrl = new AbortController()
    ;(async () => {
      const settings = await getSettings()
      const all = await db.items.toArray()
      const items = all.filter(i => settings.slots.includes(i.slot))
      // Counter-Fragen brauchen die Counter-Daten; alle Items für die Namen in der Auflösung
      const counters = await db.counters.toArray()
      const qs = buildRound(items, settings.quizKinds, Math.random, ROUND_SIZE, { counters, items: new Map(all.map(i => [i.id, i])) })
      const best = await getQuizHighscore()
      if (ctrl.signal.aborted) return
      finishing.current = false
      setCards(new Map(items.map(i => [i.id, i])))
      setQuestions(qs)
      setIndex(0)
      setAnswers([])
      setHighscore(best)
      setIsNewHighscore(false)
      setPhase(qs.length ? 'playing' : 'empty')
    })()
    return () => ctrl.abort()
  }, [round])

  const question = questions[index] as QuizQuestion | undefined
  const answered = answers[index] as Answer | undefined
  const score = answers.reduce((sum, a) => sum + a.points, 0)

  // Zeitmessung für den Bonus startet, sobald die Frage sichtbar ist
  useEffect(() => { shownAt.current = performance.now() }, [question])

  // Bilder der nächsten Fragen vorladen
  useEffect(() => {
    for (const q of questions.slice(index + 1, index + 3)) {
      const src = q.image ?? q.portrait ?? (q.subjectId ? cards.get(q.subjectId)?.image : undefined)
      if (src) new Image().src = src
    }
  }, [questions, index, cards])

  const pick = useCallback((choice: number) => {
    if (!question || answered) return
    const points = scoreAnswer(choice === question.answer, performance.now() - shownAt.current)
    setAnswers(prev => (prev.length === index ? [...prev, { question, picked: choice, points }] : prev))
  }, [question, answered, index])

  const next = useCallback(async () => {
    if (!answered) return
    if (index + 1 < questions.length) {
      setIndex(index + 1)
      return
    }
    if (finishing.current) return
    finishing.current = true
    const total = answers.reduce((sum, a) => sum + a.points, 0)
    const isBest = await submitQuizScore(total)
    setIsNewHighscore(isBest)
    if (isBest) setHighscore(total)
    setPhase('done')
  }, [answered, index, questions.length, answers])

  function restart() {
    setPhase('loading')
    setRound(r => r + 1)
  }

  // Tastatur: 1–4 = antworten, Enter/Leertaste = weiter, Esc = beenden
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') return onExit()
      if (phase !== 'playing') return
      if (!answered && ['1', '2', '3', '4'].includes(e.key)) pick(Number(e.key) - 1)
      else if (answered && (e.key === 'Enter' || e.key === ' ') && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault()
        void next()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, answered, pick, next, onExit])

  if (phase === 'loading') return <div className="center muted">Lade…</div>

  if (phase === 'empty') {
    return (
      <div className="done">
        <h2>Kein Quiz möglich</h2>
        <p className="muted">Für die gewählten Kategorien und Fragetypen gibt es zu wenige Items. Ändere die Auswahl in den Einstellungen.</p>
        <button onClick={onExit}>Zurück</button>
      </div>
    )
  }

  if (phase === 'done') {
    const correct = answers.filter(a => a.points > 0).length
    const mistakes = answers.filter(a => a.points === 0)
    return (
      <div className="quiz-result">
        <h2>Runde vorbei</h2>
        <div className="result-score">
          <div className="big">{correct} / {questions.length}</div>
          <div className="muted small">richtig</div>
          <div className="big">{score}</div>
          <div className="muted small">Punkte</div>
        </div>
        {isNewHighscore
          ? <p className="good center-text">Neuer Highscore! 🎉</p>
          : <p className="muted small center-text">Highscore: {highscore}</p>}

        {mistakes.length > 0 && (
          <div className="panel">
            <h2>Zum Merken</h2>
            <ul className="mistakes">
              {mistakes.map(({ question: q, picked }) => {
                const item = cards.get(q.itemId)
                return (
                  <li key={q.itemId}>
                    {item?.image && <img src={item.image} alt="" />}
                    <div>
                      <div className="muted small">{q.kind === 'description' && q.html ? `„${plainText(q.html)}“` : q.prompt}</div>
                      <div>Richtig: <b>{q.options[q.answer]}</b></div>
                      <div className="small error">Deine Antwort: {q.options[picked]}</div>
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>
        )}

        <div className="result-actions">
          <button className="primary" onClick={restart}>Nochmal</button>
          <button onClick={onExit}>Zurück</button>
        </div>
      </div>
    )
  }

  if (!question) return null
  const progress = ((index + (answered ? 1 : 0)) / questions.length) * 100

  return (
    <div className="quiz">
      <header className="learn-bar">
        <button className="icon-btn" onClick={onExit} aria-label="Beenden">✕</button>
        <div className="goal">
          <div className="goal-bar"><div style={{ width: `${progress}%` }} /></div>
          <span className="muted small">Frage {index + 1} / {questions.length}</span>
        </div>
        <span className="quiz-score">{score} Pkt.</span>
      </header>

      <div className="quiz-media">
        <QuestionMedia question={question} subject={question.subjectId ? cards.get(question.subjectId) : undefined} />
      </div>

      <p className="quiz-prompt">{question.prompt}</p>

      <div className="options">
        {question.options.map((option, i) => {
          const state = !answered ? '' : i === question.answer ? ' correct' : i === answered.picked ? ' wrong' : ' dim'
          return (
            <button key={`${index}-${i}`} className={`option${state}`} disabled={!!answered} onClick={() => pick(i)}>
              <span className="option-key">{i + 1}</span>
              {question.optionImages?.[i] && <img className="option-img" src={question.optionImages[i]} alt="" draggable={false} />}
              <span>{option}</span>
            </button>
          )
        })}
      </div>

      <div className="quiz-footer">
        {answered ? (
          <>
            <p className={answered.points ? 'good' : 'error'}>
              {answered.points ? `Richtig! +${answered.points}` : `Falsch – richtig: ${question.options[question.answer]}`}
            </p>
            <p className="muted small">{question.info ?? itemInfo(cards.get(question.itemId))}</p>
            <button className="primary" autoFocus onClick={() => void next()}>
              {index + 1 < questions.length ? 'Weiter' : 'Ergebnis'}
            </button>
          </>
        ) : (
          <p className="muted small center-text">Schnell antworten gibt bis zu +50 Bonus</p>
        )}
      </div>
    </div>
  )
}
