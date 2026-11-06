import { useCallback, useEffect, useRef, useState } from 'react'
import { MapCanvas, MapSymbolIcon } from '../components/MapCanvas'
import { SoulsEarned } from '../components/QuizParts'
import { getMapData } from '../data/mapSync'
import { getMapHighscore, getSettings, submitMapScore } from '../data/db'
import { vibrate } from '../game/effects'
import { finishRound } from '../game/missions'
import type { RoundAward } from '../game/souls'
import { MAP_KINDS, type MapData, type MapKind, type MapPos } from '../map/mapData'
import { buildMapRound, checkTap, MAP_QUESTION_LABEL, type MapQuestion } from '../map/mapQuiz'
import { currentNav, pushNav, type NavState } from '../nav'
import { scoreAnswer } from '../quiz/quiz'
import { MapView } from './MapView'

interface Props {
  onExit: () => void
}

interface Answer {
  question: MapQuestion
  correct: boolean
  points: number
  /** „Wo ist …?“: der Tipp */
  tap?: MapPos
  /** „Was ist hier?“: gewählte Antwort */
  picked?: number
}

type Phase = 'loading' | 'nodata' | 'empty' | 'playing' | 'done'

/** „Tippe auf …“ bzw. die Antwort als Text für „Zum Merken“ */
function questionText(q: MapQuestion): string {
  return q.type === 'where' ? q.prompt : `Was ist hier? → ${MAP_KINDS[q.kind].label}`
}

export function MapQuiz({ onExit }: Props) {
  const [round, setRound] = useState(0)
  const [phase, setPhase] = useState<Phase>('loading')
  const [data, setData] = useState<MapData | null>(null)
  const [questions, setQuestions] = useState<MapQuestion[]>([])
  const [index, setIndex] = useState(0)
  const [answers, setAnswers] = useState<Answer[]>([])
  const [highscore, setHighscore] = useState(0)
  const [isNewHighscore, setIsNewHighscore] = useState(false)
  const [earned, setEarned] = useState<RoundAward | null>(null)
  const shownAt = useRef(0)
  const finishing = useRef(false)
  // „Auf der Map zeigen“: Map über dem Ergebnis – eigener Verlaufseintrag, Zurück führt zum Ergebnis
  const [mapFocus, setMapFocus] = useState<MapKind | null>(() => currentNav().mapFocus ?? null)
  const showOnMap = useCallback((kind: MapKind) => {
    pushNav({ view: { name: 'mapquiz' }, mapFocus: kind })
    setMapFocus(kind)
  }, [])
  const closeMap = useCallback(() => {
    if (currentNav().mapFocus) window.history.back()
    else setMapFocus(null)
  }, [])
  useEffect(() => {
    const onPop = (e: PopStateEvent) => setMapFocus((e.state as NavState | null)?.mapFocus ?? null)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  useEffect(() => {
    const ctrl = new AbortController()
    ;(async () => {
      const [map, settings, best] = await Promise.all([getMapData(), getSettings(), getMapHighscore()])
      if (ctrl.signal.aborted) return
      const qs = map ? buildMapRound(map, settings.mapGroups, settings.mapQuestionTypes) : []
      finishing.current = false
      setData(map)
      setQuestions(qs)
      setIndex(0)
      setAnswers([])
      setHighscore(best)
      setIsNewHighscore(false)
      setEarned(null)
      setPhase(!map ? 'nodata' : qs.length ? 'playing' : 'empty')
    })()
    return () => ctrl.abort()
  }, [round])

  const question = questions[index] as MapQuestion | undefined
  const answered = answers[index] as Answer | undefined
  const score = answers.reduce((sum, a) => sum + a.points, 0)

  // Zeitbonus ab dem Moment, in dem die Frage sichtbar ist
  useEffect(() => { shownAt.current = performance.now() }, [question])

  const record = useCallback((answer: Omit<Answer, 'points' | 'question'>) => {
    if (!question || answered) return
    if (!answer.correct) vibrate()
    const points = scoreAnswer(answer.correct, performance.now() - shownAt.current)
    setAnswers(prev => (prev.length === index ? [...prev, { ...answer, question, points }] : prev))
  }, [question, answered, index])

  const tapMap = useCallback((pos: MapPos) => {
    if (!data || !question || question.type !== 'where') return
    record({ correct: checkTap(data, question.kind, pos).correct, tap: pos })
  }, [data, question, record])

  const pick = useCallback((choice: number) => {
    if (!question || question.type !== 'what') return
    record({ correct: choice === question.answer, picked: choice })
  }, [question, record])

  const next = useCallback(async () => {
    if (!answered) return
    if (index + 1 < questions.length) {
      setIndex(index + 1)
      return
    }
    if (finishing.current) return
    finishing.current = true
    const total = answers.reduce((sum, a) => sum + a.points, 0)
    const isBest = await submitMapScore(total)
    setIsNewHighscore(isBest)
    if (isBest) setHighscore(total)
    // Souls: Punkte ÷ 10 (ab der 4. Runde des Tages ¼) – zählt für die Tagesmission
    setEarned(await finishRound('map', total / 10, { score: total, correct: answers.filter(a => a.correct).length }))
    setPhase('done')
  }, [answered, index, questions.length, answers])

  // Tastatur: 1–4 antworten (Was ist hier?), Enter/Leertaste weiter, Esc beenden (bzw. Map schließen)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') return mapFocus ? closeMap() : onExit()
      if (phase !== 'playing' || !question) return
      if (!answered && question.type === 'what' && ['1', '2', '3', '4'].includes(e.key)) pick(Number(e.key) - 1)
      else if (answered && (e.key === 'Enter' || e.key === ' ') && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault()
        void next()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, question, answered, pick, next, onExit, mapFocus, closeMap])

  function restart() {
    setPhase('loading')
    setRound(r => r + 1)
  }

  if (phase === 'loading') return <div className="center muted">Lade…</div>

  if (phase === 'nodata' || phase === 'empty') {
    return (
      <div className="done">
        <h2>{phase === 'nodata' ? 'Noch keine Map-Daten' : 'Keine Fragen möglich'}</h2>
        <p className="muted">
          {phase === 'nodata'
            ? 'Öffne die App einmal mit Internet – die Map wird mit den übrigen Daten geladen.'
            : 'Für die gewählten Bereiche und Fragetypen gibt es keine Fragen. Ändere die Auswahl in den Einstellungen (Map-Quiz).'}
        </p>
        <button onClick={onExit}>Zurück</button>
      </div>
    )
  }

  if (phase === 'done') {
    const correct = answers.filter(a => a.correct).length
    const mistakes = answers.filter(a => !a.correct)
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
        <SoulsEarned earned={earned} />
        {mistakes.length > 0 && (
          <div className="panel">
            <h2>Zum Merken</h2>
            <ul className="mistakes">
              {mistakes.map(({ question: q }, i) => (
                <li key={`${q.kind}-${i}`}>
                  <MapSymbolIcon kind={q.kind} size={32} />
                  <div className="map-mistake">
                    <div className="muted small">{MAP_QUESTION_LABEL[q.type]}</div>
                    <div>{questionText(q)}</div>
                    <button className="link small" onClick={() => showOnMap(q.kind)}>Auf der Map zeigen</button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="result-actions">
          <button className="primary" onClick={restart}>Nochmal</button>
          <button onClick={onExit}>Zurück</button>
        </div>
        {mapFocus && (
          <div className="detail-page" role="dialog" aria-label="Map">
            <div className="detail-inner">
              <MapView key={mapFocus} focus={mapFocus} onBack={closeMap} />
            </div>
          </div>
        )}
      </div>
    )
  }

  if (!question || !data) return null
  const progress = ((index + (answered ? 1 : 0)) / questions.length) * 100
  const solution = answered ? data.points.filter(p => p.kind === question.kind) : []
  const kindInfo = MAP_KINDS[question.kind]

  return (
    <div className="quiz map-quiz">
      <header className="learn-bar">
        <button className="icon-btn" onClick={onExit} aria-label="Beenden">✕</button>
        <div className="goal">
          <div className="goal-bar"><div style={{ width: `${progress}%` }} /></div>
          <span className="muted small">Frage {index + 1} / {questions.length}</span>
        </div>
        <span className="quiz-score">{score} Pkt.</span>
      </header>

      <p className="quiz-prompt">
        <span className="map-qtype">{MAP_QUESTION_LABEL[question.type]}</span>
        {question.prompt}
      </p>

      <MapCanvas
        data={data}
        points={solution}
        highlight={answered ? question.kind : null}
        spot={question.type === 'what' ? question.spot : null}
        tap={answered?.tap ? { pos: answered.tap, correct: answered.correct } : null}
        onTap={question.type === 'where' && !answered ? tapMap : undefined}
        label={question.type === 'where' ? 'Deadlock-Map – tippe auf die gesuchte Stelle' : 'Deadlock-Map mit markierter Stelle'}
      />

      {question.type === 'what' && question.options && (
        <div className="options map-options">
          {question.options.map((kind, i) => {
            const state = !answered ? '' : i === question.answer ? ' correct' : i === answered.picked ? ' wrong' : ' dim'
            return (
              <button key={`${index}-${kind}`} className={`option${state}`} disabled={!!answered} onClick={() => pick(i)}>
                <span className="option-key">{i + 1}</span>
                <MapSymbolIcon kind={kind} />
                <span>{MAP_KINDS[kind].label}</span>
              </button>
            )
          })}
        </div>
      )}

      <div className="quiz-footer">
        {answered ? (
          <>
            <p className={answered.correct ? 'good' : 'error'}>
              {answered.correct
                ? `Richtig! +${answered.points}`
                : question.type === 'where'
                  ? `Daneben – ${solution.length > 1 ? 'alle passenden Stellen sind' : 'die richtige Stelle ist'} jetzt markiert`
                  : `Falsch – das ist: ${kindInfo.label}`}
            </p>
            {kindInfo.info && <p className="muted small">{kindInfo.label}: {kindInfo.info}</p>}
            <button className="primary" autoFocus onClick={() => void next()}>
              {index + 1 < questions.length ? 'Weiter' : 'Ergebnis'}
            </button>
          </>
        ) : (
          <p className="muted small center-text">
            {question.type === 'where' ? 'Tippe auf die Map – etwa ein Fingerbreit daneben zählt noch' : 'Schnell antworten gibt bis zu +50 Bonus'}
          </p>
        )}
      </div>
    </div>
  )
}
