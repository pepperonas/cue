import { describe, expect, it } from 'vitest'
import { TYPE_AHEAD_MS, nextIndex, placeMenu, typeAheadBuffer, typeAheadIndex } from './select'

describe('nextIndex', () => {
  it('bewegt die Markierung um eins', () => {
    expect(nextIndex(2, 'ArrowDown', 5)).toBe(3)
    expect(nextIndex(2, 'ArrowUp', 5)).toBe(1)
  })

  it('bleibt an den Enden stehen, statt umzulaufen', () => {
    // Ein natives <select> läuft nicht um, und beim Halten der Pfeiltaste
    // führte ein Umlauf endlos im Kreis.
    expect(nextIndex(4, 'ArrowDown', 5)).toBe(4)
    expect(nextIndex(0, 'ArrowUp', 5)).toBe(0)
  })

  it('springt mit Home und End an die Ränder', () => {
    expect(nextIndex(3, 'Home', 5)).toBe(0)
    expect(nextIndex(1, 'End', 5)).toBe(4)
  })

  it('springt seitenweise, ohne über die Ränder zu schießen', () => {
    expect(nextIndex(0, 'PageDown', 40)).toBe(10)
    expect(nextIndex(38, 'PageDown', 40)).toBe(39)
    expect(nextIndex(3, 'PageUp', 40)).toBe(0)
  })

  it('meldet fremde Tasten als nicht zuständig', () => {
    // Nur so kann der Aufrufer sie weiterreichen — Tab muss den Fokus
    // weitergeben, Buchstaben gehen an die Sprungsuche.
    expect(nextIndex(0, 'Tab', 5)).toBeNull()
    expect(nextIndex(0, 'a', 5)).toBeNull()
  })

  it('kommt mit einer leeren Liste zurecht', () => {
    expect(nextIndex(0, 'ArrowDown', 0)).toBeNull()
  })
})

describe('typeAheadIndex', () => {
  const labels = ['Alpha', 'Beta', 'Gamma', 'Bravo', 'Delta']

  it('findet den ersten Eintrag mit dem getippten Anfang', () => {
    expect(typeAheadIndex(labels, 'ga', 0)).toBe(2)
  })

  it('sucht ohne Rücksicht auf Groß- und Kleinschreibung', () => {
    expect(typeAheadIndex(labels, 'DEL', 0)).toBe(4)
  })

  it('blättert bei derselben Taste durch alle Treffer', () => {
    // „b", „bb", „bbb" heißt: zeig mir den NÄCHSTEN Eintrag mit b.
    expect(typeAheadIndex(labels, 'b', 0)).toBe(1)
    expect(typeAheadIndex(labels, 'bb', 1)).toBe(3)
    expect(typeAheadIndex(labels, 'bbb', 3)).toBe(1) // läuft um
  })

  it('sucht ein wachsendes Wort von vorn', () => {
    // ⚠️ Es braucht ZWEI passende Einträge, sonst findet auch eine Suche ab
    // der nächsten Zeile über den Umlauf denselben Treffer und der Test
    // beweist nichts (in der Mutationsprobe genau so passiert).
    // Nach „b" steht man auf Beta; „be" muss dort BLEIBEN, statt zum
    // nächsten be-Eintrag weiterzuspringen.
    const zwei = ['Beta', 'Gamma', 'Bergen', 'Delta']
    expect(typeAheadIndex(zwei, 'be', 0)).toBe(0)
  })

  it('meldet nichts, wenn kein Anfang passt', () => {
    expect(typeAheadIndex(labels, 'xy', 0)).toBeNull()
    expect(typeAheadIndex(labels, '', 0)).toBeNull()
  })
})

describe('typeAheadBuffer', () => {
  it('verlängert die Folge innerhalb des Fensters', () => {
    expect(typeAheadBuffer({ text: 'a', at: 1000 }, 'b', 1000 + TYPE_AHEAD_MS - 1)).toEqual({
      text: 'ab',
      at: 1000 + TYPE_AHEAD_MS - 1,
    })
  })

  it('beginnt nach der Pause von vorn', () => {
    expect(typeAheadBuffer({ text: 'a', at: 1000 }, 'b', 1000 + TYPE_AHEAD_MS + 1)).toEqual({
      text: 'b',
      at: 1000 + TYPE_AHEAD_MS + 1,
    })
  })
})

describe('placeMenu', () => {
  const hoch = 800

  it('öffnet nach unten, solange es dort passt', () => {
    const p = placeMenu({ top: 100, bottom: 140 }, 200, hoch)
    expect(p.placement).toBe('below')
    expect(p.top).toBe(146)
    expect(p.maxHeight).toBe(200)
  })

  it('klappt nach oben, wenn unten kein Platz mehr ist', () => {
    const p = placeMenu({ top: 600, bottom: 640 }, 300, hoch)
    expect(p.placement).toBe('above')
    // Direkt über dem Auslöser: unten 6 px Abstand, darüber die volle Höhe.
    expect(p.top + p.maxHeight).toBe(594)
  })

  it('deckelt die Höhe auf den vorhandenen Platz, statt hinauszuragen', () => {
    // Ein Menü, das aus dem Fenster ragt, ist die einzige Variante, die es
    // nicht geben darf — es scrollt dann in sich.
    const p = placeMenu({ top: 100, bottom: 140 }, 2000, hoch)
    expect(p.maxHeight).toBe(hoch - 140 - 6 - 8)
    expect(p.top + p.maxHeight).toBeLessThanOrEqual(hoch)
  })

  it('nimmt die größere Seite, wenn es nirgends ganz passt', () => {
    // Auslöser in der Mitte, Menü höher als beide Hälften: unten ist mehr.
    expect(placeMenu({ top: 300, bottom: 340 }, 900, hoch).placement).toBe('below')
    // Und andersherum.
    expect(placeMenu({ top: 500, bottom: 540 }, 900, hoch).placement).toBe('above')
  })

  it('bleibt auch im sehr kleinen Fenster im Bild', () => {
    // ⚠️ Der Fall muss OBEN landen und dort weniger Platz haben als die
    // Mindesthöhe — nur dann rechnet die Formel einen negativen Rand aus.
    // Mit einem Auslöser weiter oben klappt das Menü nach unten und der
    // Schutz liefe nie an (in der Mutationsprobe genau so passiert).
    // Fenster 150, Auslöser bei 100–140: unten bleibt nichts, oben 86 < 96.
    expect(placeMenu({ top: 100, bottom: 140 }, 400, 150)).toMatchObject({
      placement: 'above',
      top: 8,
    })
  })
})
