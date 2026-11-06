import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { db, getGuessHighscore, getSettings, submitGuessScore } from '../data/db'
import { vibrate } from '../game/effects'
import { finishRound } from '../game/missions'
import type { RoundAward } from '../game/souls'
import { GUESS_KIND_LABEL, type HeroCard } from '../data/model'
import {
  MAX_REVEAL, START_POINTS, abilityReveal, applyAction, buildGuessRound, jokerOptions, stageStyle, type GuessQuestion,
} from '../guess/guess'

interface Props {
  onExit: () => void
}

type Phase = 'loading' | 'empty' | 'playing' | 'done'
type Outcome = 'correct' | 'gaveup'

interface Result {
  q: GuessQuestion
  outcome: Outcome
  points: number
  wrong: number
}

function HeroTile({ hero, state, disabled, onPick }: {
  hero: HeroCard
  state?: 'correct' | 'wrong'
  disabled: boolean
  onPick: (id: string) => void
}) {
  return (
    <button className={`hero-tile${state ? ` ${state}` : ''}`} disabled={disabled} onClick={() => onPick(hero.id)} aria-label={hero.name}>
      <span className="hero-tile-img">{hero.smallImage && <img src={hero.smallImage} alt="" draggable={false} />}</span>
      <span className="hero-tile-name">{hero.name}</span>
    </button>
  )
}

/** Noch erreichbare Punkte – als Plakette oben rechts im Bild */
function PointsBadge({ points }: { points: number }) {
  return <span className="guess-points" title="So viele Punkte gibt es, wenn du jetzt richtig tippst">{points} möglich</span>
}

function Stage({ q, level, solved, hero, points }: { q: GuessQuestion; level: number; solved: boolean; hero?: HeroCard; points: number }) {
  if (q.kind === 'ability' && !solved) {
    const { count, names } = abilityReveal(q, level, solved)
    return (
      <div className="guess-stage stage-ability">
        <div className="guess-abilities">
          {(q.abilities ?? []).slice(0, count).map(a => (
            <div key={a.image} className="guess-ability">
              <img src={a.image} alt="" draggable={false} />
              {names && <span>{a.name}</span>}
            </div>
          ))}
        </div>
        <span className="guess-kind">{GUESS_KIND_LABEL[q.kind]}</span>
        <PointsBadge points={points} />
      </div>
    )
  }
  return (
    <div className={`guess-stage stage-${solved ? 'solved' : q.kind}`}>
      {q.image && <img className="guess-img" src={q.image} alt="Welcher Hero ist das?" draggable={false} style={stageStyle(q, level, solved)} />}
      {solved && q.kind === 'ability' && hero && (
        <div className="guess-ability-row">
          {(q.abilities ?? []).map(a => <img key={a.image} src={a.image} alt={a.name} title={a.name} />)}
        </div>
      )}
      <span className="guess-kind">{GUESS_KIND_LABEL[q.kind]}</span>
      {!solved && <PointsBadge points={points} />}
    </div>
  )
}

export function Guess({ onExit }: Props) {
  const [round, setRound] = useState(0)
  const [phase, setPhase] = useState<Phase>('loading')
  const [heroes, setHeroes] = useState<HeroCard[]>([])
  const [questions, setQuestions] = useState<GuessQuestion[]>([])
  const [index, setIndex] = useState(0)
  const [level, setLevel] = useState(0)
  const [points, setPoints] = useState(START_POINTS)
  const [joker, setJoker] = useState<string[] | null>(null)
  const [wrong, setWrong] = useState<string[]>([])
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [results, setResults] = useState<Result[]>([])
  const [highscore, setHighscore] = useState(0)
  const [isNewHighscore, setIsNewHighscore] = useState(false)
  const [earned, setEarned] = useState<RoundAward | null>(null)
  const finishing = useRef(false)

  /** Zustand für eine neue Frage */
  function resetQuestion() {
    setLevel(0)
    setPoints(START_POINTS)
    setJoker(null)
    setWrong([])
    setOutcome(null)
  }

  useEffect(() => {
    const ctrl = new AbortController()
    ;(async () => {
      const settings = await getSettings()
      const all = (await db.heroes.toArray()).sort((a, b) => a.name.localeCompare(b.name))
      const qs = buildGuessRound(all, settings.guessKinds)
      const best = await getGuessHighscore()
      if (ctrl.signal.aborted) return
      finishing.current = false
      resetQuestion()
      setHeroes(all)
      setQuestions(qs)
      setIndex(0)
      setResults([])
      setHighscore(best)
      setIsNewHighscore(false)
      setEarned(null)
      setPhase(qs.length ? 'playing' : 'empty')
    })()
    return () => ctrl.abort()
  }, [round])

  const byId = useMemo(() => new Map(heroes.map(h => [h.id, h])), [heroes])
  const q = questions[index] as GuessQuestion | undefined
  const answer = q ? byId.get(q.heroId) : undefined
  const total = results.reduce((sum, r) => sum + r.points, 0)

  // Bilder der nächsten Frage vorladen
  useEffect(() => {
    const nextQ = questions[index + 1]
    if (!nextQ) return
    for (const src of [nextQ.image, ...(nextQ.abilities ?? []).map(a => a.image)]) if (src) new Image().src = src
  }, [questions, index])

  const finish = useCallback((q: GuessQuestion, how: Outcome, pts: number) => {
    setOutcome(how)
    setResults(prev => (prev.length === index ? [...prev, { q, outcome: how, points: pts, wrong: wrong.length }] : prev))
  }, [index, wrong.length])

  const pick = useCallback((id: string) => {
    if (!q || outcome || wrong.includes(id)) return
    if (id === q.heroId) {
      finish(q, 'correct', points)
    } else {
      vibrate()
      setWrong(w => [...w, id])
      setPoints(p => applyAction(p, 'wrong'))
    }
  }, [q, outcome, wrong, points, finish])

  const reveal = useCallback(() => {
    if (outcome || level >= MAX_REVEAL) return
    setLevel(l => l + 1)
    setPoints(p => applyAction(p, 'reveal'))
  }, [outcome, level])

  const takeJoker = useCallback(() => {
    if (!q || outcome || joker) return
    setJoker(jokerOptions(q.heroId, heroes.map(h => h.id), Math.random, wrong))
    setPoints(p => applyAction(p, 'joker'))
  }, [q, outcome, joker, heroes, wrong])

  const giveUp = useCallback(() => {
    if (!q || outcome) return
    finish(q, 'gaveup', 0)
  }, [q, outcome, finish])

  const next = useCallback(async () => {
    if (!outcome) return
    if (index + 1 < questions.length) {
      resetQuestion()
      setIndex(index + 1)
      return
    }
    if (finishing.current) return
    finishing.current = true
    const sum = results.reduce((s, r) => s + r.points, 0)
    const best = await submitGuessScore(sum)
    setIsNewHighscore(best)
    if (best) setHighscore(sum)
    setEarned(await finishRound('guess', sum / 10, { score: sum, recognized: results.filter(r => r.outcome === 'correct').length }))
    setPhase('done')
  }, [outcome, index, questions.length, results])

  function restart() {
    setPhase('loading')
    setRound(r => r + 1)
  }

  // Esc = beenden, Enter = weiter (wenn nicht gerade ein Button den Fokus hat)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') return onExit()
      if (e.key === 'Enter' && outcome && !(e.target instanceof HTMLButtonElement)) void next()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onExit, outcome, next])

  if (phase === 'loading') return <div className="center muted">Lade…</div>

  if (phase === 'empty') {
    return (
      <div className="done">
        <h2>Noch keine Heroes</h2>
        <p className="muted">Öffne die App einmal mit Internet, damit die Hero-Daten geladen werden.</p>
        <button onClick={onExit}>Zurück</button>
      </div>
    )
  }

  if (phase === 'done') {
    const recognized = results.filter(r => r.outcome === 'correct').length
    return (
      <div className="quiz-result">
        <h2>Runde vorbei</h2>
        <div className="result-score">
          <div className="big">{recognized} / {questions.length}</div>
          <div className="muted small">erkannt</div>
          <div className="big">{total}</div>
          <div className="muted small">Punkte</div>
        </div>
        {isNewHighscore
          ? <p className="good center-text">Neuer Highscore! 🎉</p>
          : <p className="muted small center-text">Highscore: {highscore}</p>}
        {earned && (
          <p className="souls-earned center-text">
            +{earned.amount} ◆ Souls{earned.reduced && <span className="muted small"> · ab der 4. Runde heute nur ¼</span>}
          </p>
        )}
        <div className="panel">
          <h2>Deine Runde</h2>
          <ul className="mistakes">
            {results.map(r => {
              const h = byId.get(r.q.heroId)
              return (
                <li key={r.q.heroId}>
                  {h?.smallImage && <img src={h.smallImage} alt="" />}
                  <div>
                    <b>{h?.name}</b>
                    <div className={`small ${r.outcome === 'gaveup' ? 'error' : 'muted'}`}>
                      {GUESS_KIND_LABEL[r.q.kind]} · {r.outcome === 'gaveup' ? 'aufgelöst' : `${r.points} Punkte`}
                      {r.wrong > 0 && ` · ${r.wrong} Fehlversuch${r.wrong > 1 ? 'e' : ''}`}
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
        <div className="result-actions">
          <button className="primary" onClick={restart}>Nochmal</button>
          <button onClick={onExit}>Zurück</button>
        </div>
      </div>
    )
  }

  if (!q) return null
  const solved = outcome !== null
  const gridIds = joker ?? heroes.map(h => h.id)
  const progress = ((index + (solved ? 1 : 0)) / questions.length) * 100

  return (
    <div className="guess">
      <header className="learn-bar">
        <button className="icon-btn" onClick={onExit} aria-label="Beenden">✕</button>
        <div className="goal">
          <div className="goal-bar"><div style={{ width: `${progress}%` }} /></div>
          <span className="muted small">Hero {index + 1} / {questions.length}</span>
        </div>
        <span className="quiz-score">{total} Pkt.</span>
      </header>

      <Stage q={q} level={level} solved={solved} hero={answer} points={points} />

      <div className="guess-bar">
        {solved ? (
          <>
            <p className={outcome === 'correct' ? 'good' : 'error'}>
              {outcome === 'correct' ? `Richtig: ${answer?.name}! +${points}` : `Das war ${answer?.name}.`}
            </p>
            <button className="primary" autoFocus onClick={() => void next()}>
              {index + 1 < questions.length ? 'Weiter' : 'Ergebnis'}
            </button>
          </>
        ) : (
          <>
            <button onClick={reveal} disabled={level >= MAX_REVEAL}>Aufdecken −20</button>
            <button onClick={takeJoker} disabled={!!joker}>Joker ½</button>
            <button className="danger" onClick={giveUp}>Auflösen</button>
          </>
        )}
      </div>

      <div className={`guess-grid${joker ? ' joker' : ''}`}>
        {gridIds.map(id => {
          const h = byId.get(id)
          if (!h) return null
          const state = solved && id === q.heroId ? 'correct' : wrong.includes(id) ? 'wrong' : undefined
          return <HeroTile key={id} hero={h} state={state} disabled={solved || wrong.includes(id)} onPick={pick} />
        })}
      </div>
    </div>
  )
}
