import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useDictation } from './speech'

/** Scripted stand-in for the browser SpeechRecognition. */
class FakeRecognition {
  static instances: FakeRecognition[] = []
  lang = ''
  continuous = false
  interimResults = false
  onresult: ((e: unknown) => void) | null = null
  onerror: ((e: { error: string }) => void) | null = null
  onend: (() => void) | null = null
  started = 0
  stopped = 0
  aborted = 0

  constructor() {
    FakeRecognition.instances.push(this)
  }
  start() {
    this.started += 1
  }
  stop() {
    this.stopped += 1
  }
  abort() {
    this.aborted += 1
  }
}

function installFake() {
  FakeRecognition.instances = []
  ;(window as unknown as Record<string, unknown>).SpeechRecognition = FakeRecognition
  return FakeRecognition
}

function resultEvent(transcript: string, isFinal: boolean) {
  return { resultIndex: 0, results: [{ isFinal, 0: { transcript } }] }
}

afterEach(() => {
  delete (window as unknown as Record<string, unknown>).SpeechRecognition
  vi.restoreAllMocks()
})

describe('useDictation', () => {
  it('reports unsupported browsers so callers can hide the mic UI', () => {
    const { result } = renderHook(() => useDictation(() => {}))
    expect(result.current.supported).toBe(false)
    // start() on an unsupported browser is a harmless no-op.
    act(() => result.current.start())
    expect(result.current.listening).toBe(false)
  })

  it('starts continuous interim recognition and reports listening', () => {
    const Fake = installFake()
    const { result } = renderHook(() => useDictation(() => {}))
    expect(result.current.supported).toBe(true)
    act(() => result.current.start())
    expect(result.current.listening).toBe(true)
    const rec = Fake.instances[0]
    expect(rec.started).toBe(1)
    expect(rec.continuous).toBe(true)
    expect(rec.interimResults).toBe(true)
    // Double-start is ignored while a session is live.
    act(() => result.current.start())
    expect(Fake.instances.length).toBe(1)
  })

  it('delivers finalized phrases via onFinal and interim text as state', () => {
    const Fake = installFake()
    const finals: string[] = []
    const { result } = renderHook(() => useDictation((t) => finals.push(t)))
    act(() => result.current.start())
    const rec = Fake.instances[0]

    act(() => rec.onresult?.(resultEvent('hallo wel', false)))
    expect(result.current.interim).toBe('hallo wel')
    expect(finals).toEqual([])

    act(() => rec.onresult?.(resultEvent(' hallo welt ', true)))
    expect(finals).toEqual(['hallo welt']) // trimmed, delivered once
    expect(result.current.interim).toBe('') // interim cleared after the final
  })

  it('auto-restarts when Chrome ends recognition on silence', () => {
    const Fake = installFake()
    const { result } = renderHook(() => useDictation(() => {}))
    act(() => result.current.start())
    const rec = Fake.instances[0]
    act(() => rec.onend?.())
    expect(rec.started).toBe(2) // restarted transparently
    expect(result.current.listening).toBe(true)

    // After an explicit stop, onend must NOT restart.
    act(() => result.current.stop())
    act(() => rec.onend?.())
    expect(rec.started).toBe(2)
    expect(result.current.listening).toBe(false)
  })

  it('ignores routine errors but surfaces real ones and stops', () => {
    const Fake = installFake()
    const errors: string[] = []
    const { result } = renderHook(() => useDictation(() => {}, (e) => errors.push(e)))
    act(() => result.current.start())
    const rec = Fake.instances[0]

    act(() => rec.onerror?.({ error: 'no-speech' }))
    expect(result.current.listening).toBe(true)
    expect(errors).toEqual([])

    act(() => rec.onerror?.({ error: 'not-allowed' }))
    expect(errors).toEqual(['not-allowed'])
    expect(result.current.listening).toBe(false)
  })

  it('toggle flips between start and stop', () => {
    const Fake = installFake()
    const { result } = renderHook(() => useDictation(() => {}))
    act(() => result.current.toggle())
    expect(result.current.listening).toBe(true)
    act(() => result.current.toggle())
    expect(result.current.listening).toBe(false)
    expect(Fake.instances[0].stopped).toBe(1)
  })

  it('aborts the recognizer on unmount (never leaves the mic open)', () => {
    const Fake = installFake()
    const { result, unmount } = renderHook(() => useDictation(() => {}))
    act(() => result.current.start())
    unmount()
    expect(Fake.instances[0].aborted).toBe(1)
  })
})
