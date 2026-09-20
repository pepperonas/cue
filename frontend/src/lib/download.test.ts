import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { REVOKE_MS, saveTextFile } from './download'

let created: string[]
let revoked: string[]
let echtCreate: typeof URL.createObjectURL
let echtRevoke: typeof URL.revokeObjectURL

// ⚠️ NUR die beiden statischen Methoden ersetzen, nicht `URL` als Ganzes: der
// Konstruktor wird im Klick-Pfad von happy-dom gebraucht, und ein Attrappen-
// Objekt ohne ihn füllte die Ausgabe mit „URL is not a constructor" — Lärm, der
// einen echten Fehler verdeckt.
function stubUrl(create: () => string) {
  URL.createObjectURL = create as typeof URL.createObjectURL
  URL.revokeObjectURL = ((u: string) => {
    revoked.push(u)
  }) as typeof URL.revokeObjectURL
}

// Ein `download`-Anker navigiert im echten Browser nicht; happy-dom versucht es
// trotzdem. Der Standard wird hier abgefangen, damit der Test misst, was er
// behauptet.
const keineNavigation = (e: Event) => e.preventDefault()

beforeEach(() => {
  created = []
  revoked = []
  echtCreate = URL.createObjectURL
  echtRevoke = URL.revokeObjectURL
  vi.useFakeTimers()
  stubUrl(() => {
    const url = `blob:test/${created.length}`
    created.push(url)
    return url
  })
  document.addEventListener('click', keineNavigation, true)
})

afterEach(() => {
  document.removeEventListener('click', keineNavigation, true)
  URL.createObjectURL = echtCreate
  URL.revokeObjectURL = echtRevoke
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

describe('saveTextFile', () => {
  it('bietet den Text unter dem gewünschten Namen an', () => {
    let geklickt: HTMLAnchorElement | null = null
    const echt = HTMLAnchorElement.prototype.click
    HTMLAnchorElement.prototype.click = function () {
      geklickt = this as HTMLAnchorElement
    }
    try {
      expect(saveTextFile('cue-1-prompt-20260921.json', '{}')).toBe(true)
    } finally {
      HTMLAnchorElement.prototype.click = echt
    }
    expect(geklickt!.download).toBe('cue-1-prompt-20260921.json')
    expect(geklickt!.href).toBe(created[0])
  })

  it('lässt keinen Anker in der Seite zurück', () => {
    saveTextFile('x.json', '{}')
    expect(document.querySelector('a[download]')).toBeNull()
  })

  it('räumt auch auf, wenn der Klick wirft', () => {
    // Dieselbe Lehre wie in clipboard.ts: das Aufräumen gehört ins `finally`.
    const echt = HTMLAnchorElement.prototype.click
    HTMLAnchorElement.prototype.click = () => {
      throw new Error('blockiert')
    }
    try {
      expect(saveTextFile('x.json', '{}')).toBe(false)
    } finally {
      HTMLAnchorElement.prototype.click = echt
    }
    expect(document.querySelector('a[download]')).toBeNull()
    vi.advanceTimersByTime(REVOKE_MS)
    expect(revoked).toEqual(created)
  })

  it('widerruft die Objekt-URL NICHT sofort', () => {
    // Der Browser beginnt den Download erst, wenn die Ereignisschleife
    // weiterläuft — eine sofort widerrufene URL ergibt einen stillen
    // Fehlschlag.
    saveTextFile('x.json', '{}')
    expect(revoked).toEqual([])
    vi.advanceTimersByTime(REVOKE_MS)
    expect(revoked).toEqual(created)
  })

  it('meldet einen Fehlschlag, statt zu werfen', () => {
    stubUrl(() => {
      throw new Error('nicht unterstützt')
    })
    expect(saveTextFile('x.json', '{}')).toBe(false)
    // Ohne URL gibt es nichts zu widerrufen.
    vi.advanceTimersByTime(REVOKE_MS)
    expect(revoked).toEqual([])
  })
})
