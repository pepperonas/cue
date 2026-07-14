import { describe, expect, it } from 'vitest'
import { detectMac } from './platform'

describe('detectMac', () => {
  it('recognizes Apple platforms', () => {
    expect(detectMac('MacIntel')).toBe(true)
    expect(detectMac('macOS')).toBe(true)
    expect(detectMac('iPhone')).toBe(true)
    expect(detectMac('iPad')).toBe(true)
  })
  it('rejects Windows and Linux', () => {
    expect(detectMac('Win32')).toBe(false)
    expect(detectMac('Windows')).toBe(false)
    expect(detectMac('Linux x86_64')).toBe(false)
    expect(detectMac('')).toBe(false)
  })
})
