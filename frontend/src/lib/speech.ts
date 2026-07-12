// Voice dictation via the browser-native Web Speech API (SpeechRecognition).
// No backend, no keys: Chrome/Edge/Safari support it (Firefox doesn't — the
// hook reports `supported: false` and callers hide their UI).
import { useCallback, useEffect, useRef, useState } from 'react'

// Minimal typings — SpeechRecognition is not in lib.dom yet.
interface SpeechRecognitionResultLike {
  isFinal: boolean
  0: { transcript: string }
}
interface SpeechRecognitionEventLike {
  resultIndex: number
  results: ArrayLike<SpeechRecognitionResultLike>
}
interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((e: SpeechRecognitionEventLike) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}

function getRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  const w = window as unknown as Record<string, unknown>
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as
    | (new () => SpeechRecognitionLike)
    | null
}

export interface Dictation {
  supported: boolean
  listening: boolean
  /** Live not-yet-final transcript of the current utterance. */
  interim: string
  start: () => void
  stop: () => void
  toggle: () => void
}

/**
 * Continuous dictation. Final utterances are delivered through `onFinal`
 * (called once per finalized phrase); interim text is exposed as state for a
 * live readout. Chrome ends recognition after a few seconds of silence — the
 * hook restarts it transparently until `stop()` is called.
 */
export function useDictation(
  onFinal: (text: string) => void,
  onError?: (error: string) => void,
): Dictation {
  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState('')
  const recRef = useRef<SpeechRecognitionLike | null>(null)
  const wantRef = useRef(false) // user intent — drives the auto-restart on silence
  const onFinalRef = useRef(onFinal)
  onFinalRef.current = onFinal
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError

  const supported = getRecognitionCtor() !== null

  const stop = useCallback(() => {
    wantRef.current = false
    recRef.current?.stop()
    recRef.current = null
    setListening(false)
    setInterim('')
  }, [])

  const start = useCallback(() => {
    const Ctor = getRecognitionCtor()
    if (!Ctor || wantRef.current) return
    const rec = new Ctor()
    rec.lang = navigator.language || 'de-DE'
    rec.continuous = true
    rec.interimResults = true
    rec.onresult = (e) => {
      let live = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]
        const text = r[0].transcript
        if (r.isFinal) onFinalRef.current(text.trim())
        else live += text
      }
      setInterim(live.trim())
    }
    rec.onerror = (e) => {
      // 'no-speech'/'aborted' are routine; real errors end the session.
      if (e.error === 'no-speech' || e.error === 'aborted') return
      wantRef.current = false
      setListening(false)
      setInterim('')
      onErrorRef.current?.(e.error)
    }
    rec.onend = () => {
      setInterim('')
      // Chrome stops after silence — restart while the user still wants to talk.
      if (wantRef.current) {
        try {
          rec.start()
        } catch {
          setListening(false)
          wantRef.current = false
        }
      }
    }
    wantRef.current = true
    recRef.current = rec
    try {
      rec.start()
      setListening(true)
    } catch {
      wantRef.current = false
      recRef.current = null
    }
  }, [])

  const toggle = useCallback(() => {
    if (wantRef.current) stop()
    else start()
  }, [start, stop])

  // Never leave the mic open after unmount.
  useEffect(() => {
    return () => {
      wantRef.current = false
      recRef.current?.abort()
      recRef.current = null
    }
  }, [])

  return { supported, listening, interim, start, stop, toggle }
}
