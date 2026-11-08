import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  buildMistakes, formatDuration, makeBuildRound, pickName, remainingOptions, selectIcon, startProgress,
  type BuildProgress, type BuildRound,
} from '../builds/buildQuiz'
import { buildBestKey, db, getBuildBests, getMeta, setMeta, submitBuildResult, type BuildBest } from '../data/db'
import { BUILD_SOURCE_LABEL, BUILD_SOURCES, type BuildItem, type BuildRecord, type BuildSource } from '../data/model'
import { currentNav, pushNav, type NavState } from '../nav'
import { vibrate } from '../game/effects'
import { checkHeroStars } from '../game/milestones'
import { finishRound } from '../game/missions'
import { logMistake } from '../game/weakness'
import type { RoundAward, SoulsGain } from '../game/souls'
import { MilestoneSummary } from '../components/MilestoneSummary'
import { requestLearn } from '../srs/srs'
import { ItemDetail } from './ItemDetail'

interface Props {
  onExit: () => void
  /** Gleich mit diesem Hero starten (Held des Tages); fehlt sein Build in der gewählten Quelle, der typische */
  heroId?: number
}

type Phase =
  | { name: 'start' }
  | { name: 'round'; round: BuildRound; no: number }
  | { name: 'result'; round: BuildRound; progress: BuildProgress; ms: number; newBest: boolean; earned: RoundAward; stars: SoulsGain[] }

const SOURCE_HINT: Record<BuildSource, string> = {
  typical: 'Die 16 meistgekauften Items des Heroes ab Orakel (letzte 30 Tage), nach Kaufzeit.',
  community: 'Der Build, der in Matches ab Orakel am häufigsten gespielt wird – ohne optionale Abschnitte.',
}

function BestLabel({ best }: { best?: BuildBest }) {
  if (!best) return <span className="bq-best">–</span>
  return (
    <span className={`bq-best${best.errors === 0 ? ' good' : ''}`}>
      {best.errors === 0 ? '✓ ' : ''}{best.errors} · {formatDuration(best.ms)}
    </span>
  )
}

/** Community-Build: Name, Anteil der Matches, letzte Änderung */
function BuildCaption({ build }: { build: BuildRecord }) {
  if (build.source !== 'community') return null
  const parts = [`„${build.buildName}“`]
  if (build.share) parts.push(`in ${Math.round(build.share * 100)} % der ausgewerteten Matches ab Orakel`)
  if (build.lastUpdated) {
    parts.push(`Stand ${new Date(build.lastUpdated).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' })}`)
  }
  return <p className="muted small bq-caption">{parts.join(' · ')}</p>
}

interface StartProps {
  source: BuildSource
  onSource: (source: BuildSource) => void
  builds: BuildRecord[]
  bests: Record<string, BuildBest>
  onStart: (build: BuildRecord) => void
}

function StartView({ source, onSource, builds, bests, onStart }: StartProps) {
  return (
    <div className="bq">
      <div className="segmented" role="tablist" aria-label="Build-Art">
        {BUILD_SOURCES.map(s => (
          <button key={s} role="tab" aria-selected={s === source} className={s === source ? 'on' : ''} onClick={() => onSource(s)}>
            {BUILD_SOURCE_LABEL[s]}
          </button>
        ))}
      </div>
      <p className="muted small">{SOURCE_HINT[source]} Erkenne alle Items an ihren Icons.</p>
      {builds.length === 0 ? (
        <p className="muted">Build-Daten werden geladen, sobald Internet da ist.</p>
      ) : (
        <>
          <button className="primary" onClick={() => onStart(builds[Math.floor(Math.random() * builds.length)])}>Zufälliger Hero</button>
          <div className="bq-grid">
            {builds.map(b => (
              <button key={b.id} className="hero-tile" onClick={() => onStart(b)} aria-label={b.heroName}>
                <span className="hero-tile-img">{b.smallImage && <img src={b.smallImage} alt="" draggable={false} />}</span>
                <span className="hero-tile-name">{b.heroName}</span>
                <BestLabel best={bests[buildBestKey(b.source, b.heroId)]} />
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

interface RoundProps {
  round: BuildRound
  onFinish: (progress: BuildProgress, ms: number) => void
  onCancel: () => void
}

function RoundView({ round, onFinish, onCancel }: RoundProps) {
  const [progress, setProgress] = useState(() => startProgress(round))
  const [flash, setFlash] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const startedAt = useRef(0)
  const finished = useRef(false)

  // Zeit läuft ab der ersten Anzeige
  useEffect(() => {
    startedAt.current = performance.now()
    const id = window.setInterval(() => setElapsed(performance.now() - startedAt.current), 1000)
    return () => window.clearInterval(id)
  }, [])

  // Namen alphabetisch – schneller zu finden; richtig zugeordnete verschwinden
  const names = useMemo(
    () => [...remainingOptions(round, progress)].sort((a, b) => a.name.localeCompare(b.name)),
    [round, progress],
  )
  const current = round.order[progress.current]
  const tried = progress.wrong[progress.current]
  const solvedCount = progress.solved.filter(Boolean).length

  function pick(id: string) {
    if (finished.current) return
    const result = pickName(round, progress, id)
    setProgress(result.progress)
    if (!result.correct) {
      vibrate()
      // Schwächen-Training: erster Fehlversuch je Icon
      if (progress.wrong[progress.current].length === 0) void logMistake(round.order[progress.current].id, 'build')
      setFlash(id)
      window.setTimeout(() => setFlash(f => (f === id ? null : f)), 600)
    }
    if (result.done) {
      finished.current = true
      onFinish(result.progress, performance.now() - startedAt.current)
    }
  }

  return (
    <div className="bq-round">
      <header className="learn-bar">
        <button className="icon-btn" onClick={onCancel} aria-label="Abbrechen">✕</button>
        <div className="goal">
          <div className="goal-bar"><div style={{ width: `${(solvedCount / round.order.length) * 100}%` }} /></div>
          <span className="muted small">
            {round.build.heroName} · {BUILD_SOURCE_LABEL[round.build.source]} · {solvedCount} / {round.order.length}
          </span>
        </div>
        <span className="quiz-score">{formatDuration(elapsed)}</span>
      </header>
      <BuildCaption build={round.build} />

      <div className="bq-sections">
        {round.build.sections.map((section, si) => {
          const indices = round.order.map((_, k) => k).filter(k => round.sectionOf[k] === si)
          if (!indices.length) return null
          return (
            <section key={si} className="bq-section">
              <h3>{section.title}</h3>
              <div className="bq-icons">
                {indices.map(k => {
                  const item = round.order[k]
                  const solved = progress.solved[k]
                  return (
                    <button
                      key={item.id}
                      className={`bq-icon${k === progress.current ? ' current' : ''}${solved ? ' solved' : ''}`}
                      disabled={solved}
                      onClick={() => setProgress(p => selectIcon(p, k))}
                      aria-label={solved ? item.name : `Icon ${k + 1} von ${round.order.length}`}
                    >
                      <span className={`bq-img slot-bg-${item.slot}`}>{item.image && <img src={item.image} alt="" draggable={false} />}</span>
                      <span className="bq-label">{solved ? item.name : ''}</span>
                    </button>
                  )
                })}
              </div>
            </section>
          )
        })}
      </div>

      <div className="bq-pick">
        <div className="bq-current">
          <span className={`bq-img big slot-bg-${current.slot}`}>
            {current.image && <img src={current.image} alt="Welches Item ist das?" draggable={false} />}
          </span>
          <span>
            Welches Item ist das?
            <span className="muted small bq-current-section">{round.build.sections[round.sectionOf[progress.current]]?.title}</span>
          </span>
        </div>
        <div className="bq-names">
          {names.map(o => (
            <button key={o.id} className={`bq-name${flash === o.id ? ' wrong' : ''}`} disabled={tried.includes(o.id)} onClick={() => pick(o.id)}>
              {o.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

/** „93 % · ⌀ 4 min“ beim typischen Build */
function itemMeta(item: BuildItem | undefined): string | null {
  if (!item || item.pick === undefined) return null
  const parts = [`${Math.round(item.pick * 100)} %`]
  if (item.buyTime !== undefined) parts.push(`⌀ ${Math.max(1, Math.round(item.buyTime / 60))} min`)
  return parts.join(' · ')
}

interface ResultProps {
  round: BuildRound
  progress: BuildProgress
  ms: number
  newBest: boolean
  earned: RoundAward
  /** Neuer Hero-Stern (typischer Build ohne Fehler) */
  stars: SoulsGain[]
  best?: BuildBest
  onOpenItem: (id: string) => void
  onAgain: () => void
  onOther: () => void
  onExit: () => void
}

function ResultView({ round, progress, ms, newBest, earned, stars, best, onOpenItem, onAgain, onOther, onExit }: ResultProps) {
  const mistakes = useMemo(() => buildMistakes(round, progress), [round, progress])
  const missed = new Set(mistakes.map(m => m.item.id))
  const buildItems = new Map(round.build.sections.flatMap(s => s.items).map(i => [i.itemId, i]))
  const [learned, setLearned] = useState(false)

  async function learnMistakes() {
    for (const m of mistakes) await requestLearn(m.item.id)
    setLearned(true)
  }

  return (
    <div className="bq-result">
      <h2>{round.build.heroName} – {BUILD_SOURCE_LABEL[round.build.source]}</h2>
      <BuildCaption build={round.build} />
      <div className="result-score">
        <div className="big">{progress.errors}</div>
        <div className="muted small">Fehlversuche</div>
        <div className="big">{formatDuration(ms)}</div>
        <div className="muted small">Zeit · {round.order.length} Items</div>
      </div>
      {newBest
        ? <p className="good center-text">Neuer Bestwert! 🎉</p>
        : best && <p className="muted small center-text">Bestwert: {best.errors} Fehler · {formatDuration(best.ms)}</p>}
      <p className="souls-earned center-text">
        +{earned.amount} ◆ Souls{earned.reduced && <span className="muted small"> · ab der 4. Runde heute nur ¼</span>}
      </p>
      <MilestoneSummary gains={stars} />

      {mistakes.length > 0 && (
        <div className="panel">
          <h2>Vertan bei</h2>
          <ul className="mistakes">
            {mistakes.map(m => (
              <li key={m.item.id}>
                {m.item.image && <img src={m.item.image} alt="" />}
                <div>
                  <button className="link" onClick={() => onOpenItem(m.item.id)}>{m.item.name}</button>
                  <div className="small error">du: {m.picked.map(p => p.name).join(', ')}</div>
                </div>
              </li>
            ))}
          </ul>
          {learned
            ? <p className="good small">Vorgemerkt – kommen in der nächsten Item-Lernsession dran.</p>
            : <button onClick={() => void learnMistakes()}>Fehler-Items lernen ({mistakes.length})</button>}
        </div>
      )}

      <div className="panel">
        <h2>Der ganze Build</h2>
        {round.build.sections.map((section, si) => {
          const list = round.order.filter((_, k) => round.sectionOf[k] === si)
          if (!list.length) return null
          return (
            <section key={si} className="bq-section">
              <h3>{section.title}</h3>
              <ul className="bq-list">
                {list.map(item => (
                  <li key={item.id} className={missed.has(item.id) ? 'missed' : undefined}>
                    <span className={`bq-img small slot-bg-${item.slot}`}>{item.image && <img src={item.image} alt="" />}</span>
                    <button className="link" onClick={() => onOpenItem(item.id)}>{item.name}</button>
                    <span className="muted small bq-meta">{itemMeta(buildItems.get(item.id))}</span>
                  </li>
                ))}
              </ul>
            </section>
          )
        })}
      </div>

      <div className="result-actions">
        <button className="primary" onClick={onAgain}>Nochmal</button>
        <button onClick={onOther}>Anderer Hero</button>
      </div>
      <button onClick={onExit}>Zurück</button>
    </div>
  )
}

export function BuildQuiz({ onExit, heroId }: Props) {
  const [source, setSource] = useState<BuildSource | null>(null)
  useEffect(() => { void getMeta<BuildSource>('buildSource', 'typical').then(setSource) }, [])
  const builds = useLiveQuery(
    async () => (source ? (await db.builds.where('source').equals(source).toArray()).sort((a, b) => a.heroName.localeCompare(b.heroName)) : undefined),
    [source],
  )
  const allItems = useLiveQuery(() => db.items.toArray(), [])
  const items = useMemo(() => new Map((allItems ?? []).map(i => [i.id, i])), [allItems])
  const bests = useLiveQuery(() => getBuildBests(), [])
  const [phase, setPhase] = useState<Phase>({ name: 'start' })
  const rounds = useRef(0)
  /** Held des Tages: einmal direkt starten */
  const autoStarted = useRef(false)

  // Item-Detailseite über dem Quiz – als Verlaufseintrag, damit „Zurück“ hierher führt
  const [detailId, setDetailId] = useState<string | null>(() => currentNav().item ?? null)
  const openItem = useCallback((id: string) => {
    pushNav({ view: { name: 'builds' }, item: id })
    setDetailId(id)
  }, [])
  const closeDetail = useCallback(() => {
    if (currentNav().item) window.history.back()
    else setDetailId(null)
  }, [])
  useEffect(() => {
    const onPop = (e: PopStateEvent) => setDetailId((e.state as NavState | null)?.item ?? null)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const toStart = useCallback(() => setPhase({ name: 'start' }), [])
  // Esc: Detailseite schließen, sonst Runde abbrechen bzw. Modus verlassen
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      if (detailId) closeDetail()
      else if (phase.name === 'round') toStart()
      else onExit()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [detailId, closeDetail, phase.name, toStart, onExit])

  function changeSource(next: BuildSource) {
    setSource(next)
    void setMeta('buildSource', next)
  }

  function start(build: BuildRecord) {
    const round = makeBuildRound(build, items)
    if (round) setPhase({ name: 'round', round, no: ++rounds.current })
  }

  // Held des Tages: sobald Builds und Items da sind, gleich mit ihm starten
  useEffect(() => {
    if (heroId === undefined || autoStarted.current || !builds || !allItems?.length) return
    autoStarted.current = true
    void (async () => {
      const own = builds.find(b => b.heroId === heroId)
        ?? (await db.builds.where('source').equals('typical').filter(b => b.heroId === heroId).first())
      const round = own && makeBuildRound(own, new Map(allItems.map(i => [i.id, i])))
      if (round) setPhase({ name: 'round', round, no: ++rounds.current })
    })()
  }, [heroId, builds, allItems])

  async function finish(round: BuildRound, progress: BuildProgress, ms: number) {
    const key = buildBestKey(round.build.source, round.build.heroId)
    const newBest = await submitBuildResult(key, { errors: progress.errors, ms })
    // Hero-Stern: typischer Build ohne Fehler
    const stars = round.build.source === 'typical' ? await checkHeroStars([round.build.heroId]) : []
    // Souls: +5 je Item, +50 ohne Fehler (ab der 4. Runde des Tages ¼)
    const earned = await finishRound('build', 5 * round.order.length + (progress.errors === 0 ? 50 : 0), {
      errors: progress.errors, items: round.order.length, heroId: round.build.heroId, source: round.build.source,
    })
    setPhase({ name: 'result', round, progress, ms, newBest, earned, stars })
  }

  if (!source || !builds || !allItems || !bests) return <div className="center muted">Lade…</div>
  const detail = detailId ? items.get(detailId) : undefined

  return (
    <div className="bq-page">
      {phase.name === 'start' && (
        <>
          <header className="home-head">
            <button className="icon-btn" onClick={onExit} aria-label="Zurück">←</button>
            <h1>Build-Quiz</h1>
            <span className="icon-btn" aria-hidden="true" />
          </header>
          <StartView source={source} onSource={changeSource} builds={builds} bests={bests} onStart={start} />
        </>
      )}
      {phase.name === 'round' && (
        <RoundView key={phase.no} round={phase.round} onFinish={(p, ms) => void finish(phase.round, p, ms)} onCancel={toStart} />
      )}
      {phase.name === 'result' && (
        <ResultView
          round={phase.round}
          progress={phase.progress}
          ms={phase.ms}
          newBest={phase.newBest}
          earned={phase.earned}
          stars={phase.stars}
          best={bests[buildBestKey(phase.round.build.source, phase.round.build.heroId)]}
          onOpenItem={openItem}
          onAgain={() => start(phase.round.build)}
          onOther={toStart}
          onExit={onExit}
        />
      )}
      {detail && allItems && (
        <ItemDetail key={detail.id} card={detail} cards={allItems} onBack={closeDetail} onOpen={openItem} backLabel="Build-Quiz" />
      )}
    </div>
  )
}
