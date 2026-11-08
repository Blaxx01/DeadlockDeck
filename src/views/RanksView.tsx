import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect } from 'react'
import { RankBadge } from '../components/RankBadge'
import { getMeta } from '../data/db'
import { rankLadder } from '../game/rankLadder'
import { rankForSouls, rankLabel, rankName, SUBRANKS, type RankAsset } from '../game/ranks'
import { getSoulsBest, getSoulsTotal } from '../game/souls'

interface Props {
  onBack: () => void
  onStats: () => void
}

const fmt = (n: number) => n.toLocaleString('de-DE')

/** Alle Ränge: wo du stehst, was als Nächstes kommt, was die Ränge bei den Tagesmissionen freischalten */
export function RanksView({ onBack, onStats }: Props) {
  const s = useLiveQuery(async () => {
    const [total, best, assets] = await Promise.all([getSoulsTotal(), getSoulsBest(), getMeta<RankAsset[]>('ranks', [])])
    return { total, best, assets }
  }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onBack() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onBack])

  if (!s) return <div className="center muted">Lade…</div>
  const rank = rankForSouls(s.total)
  const best = rankForSouls(Math.max(s.best, s.total))
  const ladder = rankLadder(s.total, s.best)

  return (
    <div className="ranks-page">
      <header className="home-head">
        <button className="icon-btn" onClick={onBack} aria-label="Zurück">←</button>
        <h1>Ränge</h1>
        <span className="icon-btn" aria-hidden="true" />
      </header>

      <section className="panel rank-now">
        <RankBadge rank={rank} assets={s.assets} className="big" />
        <div className="rank-now-name">{rankLabel(rank, s.assets)}</div>
        <div className="muted small">◆ {fmt(s.total)} Souls</div>
        {rank.tier > 0 && (
          <div className="rank-subs" role="img" aria-label={`Stufe ${rank.sub} von ${SUBRANKS}`}>
            {Array.from({ length: SUBRANKS }, (_, i) => <span key={i} className={i < rank.sub ? 'on' : undefined} />)}
          </div>
        )}
        <span className="goal-bar rank-bar"><span style={{ width: `${Math.round(rank.progress * 100)}%` }} /></span>
        <div className="muted small">
          {rank.next ? `noch ${fmt(rank.next.souls - s.total)} ◆ bis ${rankLabel(rank.next, s.assets)}` : 'Höchster Rang erreicht'}
        </div>
        {best.index > rank.index && (
          <p className="small rank-best">Höchster Rang bisher: <b>{rankLabel(best, s.assets)}</b> – was er freigeschaltet hat, bleibt.</p>
        )}
      </section>

      <section className="panel">
        <h2>Alle Ränge</h2>
        <ol className="rank-ladder">
          {ladder.map(t => (
            <li key={t.tier} className={`rank-step ${t.state}`} aria-current={t.state === 'current' ? 'step' : undefined}>
              <RankBadge rank={{ tier: t.tier, sub: 0 }} assets={s.assets} />
              <span className="rank-step-main">
                <span className="rank-step-head">
                  <b>{rankName(t.tier, s.assets)}</b>
                  <span className="small rank-step-state">
                    {t.state === 'current' ? 'Du bist hier' : t.state === 'reached' ? '✓ erreicht' : `noch ${fmt(t.missing ?? 0)} ◆`}
                  </span>
                </span>
                <span className="muted small">{t.tier === 0 ? 'Start' : `ab ${fmt(t.souls)} ◆ · ${SUBRANKS} Stufen`}</span>
                {t.unlock && (
                  <span className={`small rank-step-unlock${t.unlock.unlocked ? ' on' : ''}`}>
                    {t.unlock.unlocked ? '🔓' : '🔒'} Tagesmissionen: {t.unlock.text}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ol>
      </section>

      <section className="panel">
        <h2>So steigst du auf</h2>
        <ul className="rank-rules small">
          <li><b>+10 ◆</b> je Karte und Tag – gewusst oder nicht</li>
          <li><b>+100 ◆</b> fürs Tagesziel, <b>+100 ◆</b> je Tagesmission, <b>+150 ◆</b> für alle drei – dazu der Serien-Bonus im Lane-Angriff</li>
          <li>
            Spielrunden: Quiz, Hero erraten und Map-Quiz Punkte ÷ 10, Build-Quiz +5 je Item (+50 ohne Fehler), Sprint +5 je richtige
            Antwort, Überleben +10 je Frage – je Modus und Tag die ersten 3 Runden voll, danach ¼
          </li>
          <li>Meilensteine: Karte erstmals Silber +25 ◆, Gold +50 ◆, neuer Hero-Stern +100 ◆</li>
          <li className="muted">
            Ab dem 6. Tag ohne Lernen kostet jeder Tag 50 ◆ (Rang-Verfall), Lane tauschen kostet Souls. Was ein Rang bei den
            Tagesmissionen freischaltet, bleibt frei – es zählt der höchste erreichte Rang.
          </li>
        </ul>
        <button className="link small" onClick={onStats}>Statistik ›</button>
      </section>
    </div>
  )
}
