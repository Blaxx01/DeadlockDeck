import { describe, expect, it } from 'vitest'
import { checkAnswer, levenshtein, normalizeName } from './typing'

const ITEMS = ['Headhunter', 'Headshot Booster', 'High-Velocity Rounds', 'Extra Health', 'Extra Spirit', 'Extra Regen', 'Ammo Scavenger', 'Spirit Strike', 'Spirit Snatch', 'Kinetic Dash', 'Rapid Rounds', 'Mystic Burst', 'Mystic Shot']

describe('Antwort eintippen', () => {
  it('vergleicht ohne Groß/Klein, Leerzeichen und Satzzeichen', () => {
    expect(normalizeName('  High-Velocity  Rounds! ')).toBe('highvelocityrounds')
    expect(checkAnswer('high velocity rounds', ['High-Velocity Rounds'], ITEMS)).toEqual({ correct: true, match: 0 })
    expect(checkAnswer('HEADHUNTER', ['Headhunter'], ITEMS)).toEqual({ correct: true, match: 0 })
  })

  it('kleine Tippfehler sind ok, ein anderer echter Name nie', () => {
    expect(levenshtein('headhunter', 'haedhunter')).toBe(2)
    expect(checkAnswer('Haedhunter', ['Headhunter'], ITEMS).correct).toBe(true)
    expect(checkAnswer('Kinetik Dash', ['Kinetic Dash'], ITEMS).correct).toBe(true)
    expect(checkAnswer('Mystic Shot', ['Mystic Burst'], ITEMS).correct).toBe(false)
    expect(checkAnswer('Extra Spirit', ['Extra Regen'], ITEMS).correct).toBe(false)
    expect(checkAnswer('Hedshot Boster', ['Headhunter'], ITEMS).correct).toBe(false)
  })

  it('eindeutiger Anfang ab 4 Buchstaben', () => {
    expect(checkAnswer('headh', ['Headhunter'], ITEMS).correct).toBe(true)
    expect(checkAnswer('high-v', ['High-Velocity Rounds'], ITEMS).correct).toBe(true)
    expect(checkAnswer('hig', ['High-Velocity Rounds'], ITEMS).correct).toBe(false)
    // mehrdeutig: „Extra …“
    expect(checkAnswer('extra', ['Extra Health'], ITEMS).correct).toBe(false)
    expect(checkAnswer('extra h', ['Extra Health'], ITEMS).correct).toBe(true)
  })

  it('Counter: eins der Top 3 reicht – mit welchem', () => {
    const top = ['Spirit Strike', 'Ammo Scavenger', 'Spirit Snatch']
    expect(checkAnswer('ammo scav', top, ITEMS)).toEqual({ correct: true, match: 1 })
    expect(checkAnswer('spirit snach', top, ITEMS)).toEqual({ correct: true, match: 2 })
    // beide Treffer des Anfangs sind richtig
    expect(checkAnswer('spirit s', top, ITEMS)).toEqual({ correct: true, match: 0 })
    expect(checkAnswer('Rapid Rounds', top, ITEMS).correct).toBe(false)
    expect(checkAnswer('', top, ITEMS).correct).toBe(false)
  })
})
