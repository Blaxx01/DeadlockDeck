import { useState } from 'react'

/** Rückrichtung, Vorderseite: nur der Name und die Frage */
export function ReverseFront({ name, question }: { name: string; question: string }) {
  return (
    <div className="front-content reverse-front">
      <span className="reverse-tag">Rückrichtung</span>
      <div className="reverse-name">{name}</div>
      <p className="reverse-question">{question}</p>
      <p className="hint">Tippen zum Umdrehen</p>
    </div>
  )
}

/** Rückrichtung, Rückseite oben: das Bild, das vorne bei der normalen Karte steht */
export function ReverseImage({ src, kind }: { src?: string; kind: 'item' | 'ability' | 'hero' }) {
  const [failed, setFailed] = useState(false)
  if (!src || failed) return null
  return (
    <div className={`reverse-image kind-${kind}`}>
      <img src={src} alt="" draggable={false} onError={() => setFailed(true)} />
    </div>
  )
}
