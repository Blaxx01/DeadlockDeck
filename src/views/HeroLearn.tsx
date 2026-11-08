import { useEffect, useState } from 'react'
import { heroSessionCards } from '../game/missions'
import type { HeroPick } from '../game/dayHero'
import { Learn } from './Learn'

interface Props {
  onExit: () => void
}

/** Held des Tages: Session mit den Karten seiner Mission, die heute noch nicht dran waren */
export function HeroLearn({ onExit }: Props) {
  // einmal beim Öffnen festgelegt – während der Session ändert sich die Auswahl nicht
  const [session, setSession] = useState<{ hero: HeroPick; ids: string[] } | null | undefined>(undefined)
  useEffect(() => { void heroSessionCards().then(setSession) }, [])

  if (session === undefined) return <div className="center muted">Lade…</div>
  if (!session || session.ids.length === 0) {
    return (
      <div className="done">
        <h2>{session ? `Alle Karten von ${session.hero.name} sind für heute dran gewesen` : 'Heute keine Karten-Mission'}</h2>
        <p className="muted">Die Mission des Helden des Tages zählt jede seiner Karten einmal am Tag.</p>
        <button onClick={onExit}>Zurück</button>
      </div>
    )
  }
  return <Learn deck="heroes" cardIds={session.ids} navView={{ name: 'herolearn' }} onExit={onExit} />
}
