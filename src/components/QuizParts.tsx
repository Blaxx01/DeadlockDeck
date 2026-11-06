import { useMemo } from 'react'
import type { ItemCard } from '../data/model'
import { sanitizeHtml } from '../data/sanitize'
import type { RoundAward } from '../game/souls'
import type { QuizQuestion } from '../quiz/quiz'

/** „+80 ◆ Souls“ (ab der 4. Runde des Tages mit Hinweis) */
export function SoulsEarned({ earned }: { earned: RoundAward | null }) {
  if (!earned) return null
  return (
    <p className="souls-earned center-text">
      +{earned.amount} ◆ Souls{earned.reduced && <span className="muted small"> · ab der 4. Runde heute nur ¼</span>}
    </p>
  )
}

/** Bild, Porträt, Effekttext oder Item zur Frage */
export function QuestionMedia({ question, subject }: { question: QuizQuestion; subject?: ItemCard }) {
  const html = useMemo(() => (question.html ? sanitizeHtml(question.html) : ''), [question.html])
  if (question.kind === 'upgrade') {
    return (
      <div className="quiz-ability">
        {question.image && <img src={question.image} alt="" draggable={false} />}
        {question.caption && <span className="muted small">{question.caption}</span>}
      </div>
    )
  }
  if (question.kind === 'effect' && question.subjectText) {
    return <div className="quiz-effect">{question.subjectText}</div>
  }
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

/**
 * Die 4 Antworten. `picked`: gewählte Antwort (−1 = Zeit abgelaufen), danach richtig/falsch markiert.
 */
export function QuizOptions({ question, picked, onPick, keyPrefix = '' }: {
  question: QuizQuestion
  picked?: number | null
  onPick: (choice: number) => void
  keyPrefix?: string
}) {
  const answered = picked !== undefined && picked !== null
  return (
    <div className="options">
      {question.options.map((option, i) => {
        const state = !answered ? '' : i === question.answer ? ' correct' : i === picked ? ' wrong' : ' dim'
        return (
          <button key={`${keyPrefix}-${i}`} className={`option${state}`} disabled={answered} onClick={() => onPick(i)}>
            <span className="option-key">{i + 1}</span>
            {question.optionImages?.[i] && <img className="option-img" src={question.optionImages[i]} alt="" draggable={false} />}
            <span>{option}</span>
          </button>
        )
      })}
    </div>
  )
}

/** Kleines Bild zur Frage in der Fehlerliste: Item, Fähigkeit (Upgrade-Frage) */
export function QuestionThumb({ question, items }: { question: QuizQuestion; items: ReadonlyMap<string, ItemCard> }) {
  const src = question.kind === 'upgrade' ? question.image : items.get(question.itemId)?.image
  return src ? <img src={src} alt="" className={question.kind === 'upgrade' ? 'thumb-ability' : undefined} /> : null
}
