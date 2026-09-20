import { describe, expect, it } from 'vitest'
import {
  CAPS_KEY,
  SECTIONS_KEY,
  adoptLegacy,
  loadFolds,
  saveFolds,
  withFold,
} from './fold-store'

/** Ein Speicher, der sich prüfen lässt — und der auch scheitern kann. */
function speicher(start: Record<string, string> = {}, wirft = false) {
  const daten = { ...start }
  return {
    daten,
    getItem: (k: string) => daten[k] ?? null,
    setItem: (k: string, v: string) => {
      if (wirft) throw new Error('quota')
      daten[k] = v
    },
  }
}

describe('loadFolds', () => {
  it('liest, was gespeichert ist', () => {
    const s = speicher({ [CAPS_KEY]: '{"col:done":true}' })
    expect(loadFolds(s, CAPS_KEY)).toEqual({ 'col:done': true })
  })

  it('kommt ohne Speicher aus', () => {
    // Ein privates Fenster hat keinen — das Board muss trotzdem laufen.
    expect(loadFolds(null, CAPS_KEY)).toEqual({})
  })

  it('wirft kaputte Einträge weg, statt sie mitzuschleppen', () => {
    // ⚠️ `[true]` ist der entscheidende Fall: alles andere fängt schon der
    // Wahrheitswert-Filter darunter ab, eine LISTE von Wahrheitswerten käme
    // ohne die Strukturprüfung als {"0":true} durch (Mutationsprobe).
    for (const roh of ['kein json', '[]', '[true]', 'null', '"text"', '5']) {
      expect(loadFolds(speicher({ [CAPS_KEY]: roh }), CAPS_KEY)).toEqual({})
    }
  })

  it('behält nur Wahrheitswerte', () => {
    // ⚠️ Eine 1 oder ein "true" aus einer fremden Fassung würde als offen
    // gelesen und ließe das Board etwas anderes zeigen als gespeichert ist.
    const s = speicher({ [CAPS_KEY]: '{"a":true,"b":1,"c":"true","d":false}' })
    expect(loadFolds(s, CAPS_KEY)).toEqual({ a: true, d: false })
  })
})

describe('withFold', () => {
  it('setzt einen Schlüssel', () => {
    expect(withFold({}, 'col:done', true)).toEqual({ 'col:done': true })
  })

  it('räumt mit Vorgabe weg, was der Vorgabe entspricht', () => {
    // Die Spalten-Erweiterung ist immer „gedeckelt" — ein false ist Müll und
    // ließe den Eintrag mit jedem je geöffneten Projekt weiterwachsen.
    expect(withFold({ a: true }, 'a', false, false)).toEqual({})
  })

  it('behält OHNE Vorgabe auch eine Wahl, die gerade der Vorgabe gleicht', () => {
    // ⚠️ Der entscheidende Fall: die Vorgabe einer Sektion hängt an der
    // Kartenzahl. Räumte man hier weg, verschwände die ausdrückliche Wahl,
    // sobald eine Karte dazukommt.
    expect(withFold({}, 'proj:7', true)).toEqual({ 'proj:7': true })
    expect(withFold({}, 'proj:7', false)).toEqual({ 'proj:7': false })
  })

  it('fasst den übergebenen Zustand nicht an', () => {
    const vorher = { a: true }
    withFold(vorher, 'b', true)
    expect(vorher).toEqual({ a: true })
  })
})

describe('saveFolds', () => {
  it('schreibt als JSON', () => {
    const s = speicher()
    saveFolds(s, CAPS_KEY, { a: true })
    expect(JSON.parse(s.daten[CAPS_KEY])).toEqual({ a: true })
  })

  it('bleibt bei vollem Speicher still', () => {
    // Ein voller Speicher darf die Bedienung nicht anhalten — der Zustand gilt
    // dann eben nur für diese Sitzung.
    expect(() => saveFolds(speicher({}, true), CAPS_KEY, { a: true })).not.toThrow()
  })

  it('kommt ohne Speicher aus', () => {
    expect(() => saveFolds(null, CAPS_KEY, { a: true })).not.toThrow()
  })
})

describe('adoptLegacy', () => {
  it('übernimmt den alten Sitzungs-Zustand beim ersten Mal', () => {
    const lokal = speicher()
    const sitzung = speicher({ [SECTIONS_KEY]: '{"col:done":false}' })
    expect(adoptLegacy(lokal, sitzung, SECTIONS_KEY)).toEqual({ 'col:done': false })
    // Und behält ihn: beim nächsten Start steht er schon im richtigen Speicher.
    expect(JSON.parse(lokal.daten[SECTIONS_KEY])).toEqual({ 'col:done': false })
  })

  it('lässt einen vorhandenen Zustand in Ruhe', () => {
    // ⚠️ Sonst überschriebe ein alter Sitzungs-Eintrag bei jedem Aufruf das,
    // was der Nutzer seither eingestellt hat.
    const lokal = speicher({ [SECTIONS_KEY]: '{"neu":true}' })
    const sitzung = speicher({ [SECTIONS_KEY]: '{"alt":false}' })
    expect(adoptLegacy(lokal, sitzung, SECTIONS_KEY)).toEqual({ neu: true })
    expect(JSON.parse(lokal.daten[SECTIONS_KEY])).toEqual({ neu: true })
  })

  it('bleibt leer, wenn es nirgends etwas gibt', () => {
    expect(adoptLegacy(speicher(), speicher(), SECTIONS_KEY)).toEqual({})
  })
})
