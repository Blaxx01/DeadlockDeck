// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { sanitizeHtml } from './sanitize'

describe('sanitizeHtml', () => {
  it('entfernt gefährliche Tags und Attribute', () => {
    const out = sanitizeHtml('Hi <img src=x onerror="alert(1)"><script>alert(2)</script><b onclick="x()">fett</b>')
    expect(out).toBe('Hi <b>fett</b>')
  })
  it('behält erlaubte Formatierung und Klassen', () => {
    expect(sanitizeHtml('<span class="key">R</span><br>Text')).toBe('<span class="key">R</span><br>Text')
  })
  it('behält den Text unbekannter Tags', () => {
    expect(sanitizeHtml('<Panel class="x">Innen</Panel>')).toBe('Innen')
  })
})
