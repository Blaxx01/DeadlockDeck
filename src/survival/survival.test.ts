import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { DeckDB, getSurvivalHighscore, submitSurvivalScore } from '../data/db'
import type { SlotType } from '../data/model'
import { item } from '../test/counterFixtures'
import {
  answerSurvival, BATCH_SIZE, LIVES, nextSurvival, secondsFor, startRun, startSurvival, survivalBatch, survivalReducer, timeLeft, TIMEOUT,
} from './survival'

describe('Überleben', () => {
  it('15 s pro Frage, alle 5 Fragen 1 s weniger, nie unter 6 s', () => {
    expect([0, 4, 5, 9, 10, 40, 44, 45, 100].map(secondsFor)).toEqual([15, 15, 14, 14, 13, 7, 7, 6, 6])
  })

  it('falsch oder Zeit abgelaufen kostet ein Leben; bei 0 Leben ist Schluss', () => {
    const q = { answer: 2 }
    let s = startSurvival()
    expect(s).toEqual({ index: 0, lives: LIVES, score: 0, picked: null, over: false })
    s = answerSurvival(s, q, 2)
    expect(s).toMatchObject({ score: 1, lives: 3, picked: 2 })
    // doppelt antworten zählt nicht
    expect(answerSurvival(s, q, 0)).toBe(s)
    s = nextSurvival(s)
    expect(s).toMatchObject({ index: 1, picked: null })
    // weiter geht erst nach einer Antwort
    expect(nextSurvival(s)).toBe(s)
    s = nextSurvival(answerSurvival(s, q, 0))
    s = nextSurvival(answerSurvival(s, q, TIMEOUT))
    expect(s).toMatchObject({ index: 3, lives: 1, score: 1, over: false })
    s = answerSurvival(s, q, 1)
    expect(s).toMatchObject({ lives: 0, over: true, score: 1 })
    expect(nextSurvival(s)).toBe(s)
  })

  it('Fragen gemischt aus den gewählten Fragetypen', () => {
    const slots: SlotType[] = ['weapon', 'vitality', 'spirit']
    const items = Array.from({ length: 60 }, (_, i) => item(i + 1, `Item ${i + 1}`, slots[i % 3], {
      tier: 1 + (i % 4),
      cost: [800, 1600, 3200, 6400][i % 4],
      timings: i % 2 ? [{ kind: 'cooldown', label: 'Abklingzeit', value: `${10 + i}s` }] : [],
      sections: [{ type: 'passive', html: `Effekt Nummer ${i}: macht etwas Besonderes für ein paar Sekunden.`, stats: [] }],
    }))
    const batch = survivalBatch(items, ['image', 'number', 'description'])
    expect(batch.length).toBe(BATCH_SIZE)
    expect(new Set(batch.map(q => q.kind)).size).toBeGreaterThan(1)
    expect(new Set(batch.map(q => q.itemId)).size).toBe(batch.length)
  })

  it('Highscore = überlebte Fragen', async () => {
    const database = new DeckDB(`sv-${Math.random()}`)
    expect(await submitSurvivalScore(12, database)).toBe(true)
    expect(await submitSurvivalScore(9, database)).toBe(false)
    expect(await getSurvivalHighscore(database)).toBe(12)
  })
})

describe('Überleben: Ablauf mit Zeit', () => {
  it('Zeit läuft ab → Leben weg; Hintergrund zählt nicht; nächste Frage startet neu', () => {
    let r = startRun(0)
    expect(timeLeft(r)).toBe(15_000)
    r = survivalReducer(r, { type: 'tick', now: 5_000 })
    expect(timeLeft(r)).toBe(10_000)
    // 20 s im Hintergrund: kein Zeitablauf
    r = survivalReducer(r, { type: 'hide', now: 6_000 })
    r = survivalReducer(r, { type: 'tick', now: 25_000 })
    expect(r.picked).toBeNull()
    expect(timeLeft(r)).toBe(9_000)
    r = survivalReducer(r, { type: 'show', now: 26_000 })
    expect(timeLeft(r)).toBe(9_000)
    r = survivalReducer(r, { type: 'tick', now: 35_000 })
    expect(r).toMatchObject({ picked: TIMEOUT, lives: 2, score: 0 })
    // zu spät antworten zählt nicht
    expect(survivalReducer(r, { type: 'answer', picked: 1, answer: 1, now: 35_100 })).toBe(r)
    r = survivalReducer(r, { type: 'next', now: 40_000 })
    expect(r).toMatchObject({ index: 1, picked: null, pausedMs: 0 })
    expect(timeLeft(r)).toBe(15_000)
    r = survivalReducer(r, { type: 'answer', picked: 1, answer: 1, now: 41_000 })
    expect(r).toMatchObject({ score: 1, lives: 2, picked: 1 })
    r = survivalReducer(survivalReducer(r, { type: 'next', now: 42_000 }), { type: 'answer', picked: 3, answer: 0, now: 43_000 })
    expect(r.misses).toEqual([{ index: 0, picked: TIMEOUT }, { index: 2, picked: 3 }])
  })

  it('ab Frage 6 gibt es 14 s', () => {
    let r = startRun(0)
    for (let i = 0; i < 5; i++) {
      r = survivalReducer(r, { type: 'answer', picked: 0, answer: 0, now: i * 1000 + 500 })
      r = survivalReducer(r, { type: 'next', now: (i + 1) * 1000 })
    }
    expect(r.index).toBe(5)
    expect(timeLeft(r)).toBe(14_000)
  })
})
