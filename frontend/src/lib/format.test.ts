import { describe, expect, it } from 'vitest'
import { formatBytes } from './format'

describe('formatBytes', () => {
  it('shows raw bytes below a kilobyte', () => {
    expect(formatBytes(70)).toBe('70 B')
    expect(formatBytes(1023)).toBe('1023 B')
  })

  it('shows whole kilobytes in the range screenshots land in', () => {
    expect(formatBytes(1024)).toBe('1 KB')
    expect(formatBytes(45_388)).toBe('44 KB')
    expect(formatBytes(193_533)).toBe('189 KB')
  })

  it('switches to MB before the KB value can reach four digits', () => {
    // The wart this exists for: comparing the UNROUNDED value let 1023,99 KB
    // print as "1024 KB" — a unit the reader then has to convert themselves.
    expect(formatBytes(1024 * 1023.99)).toBe('1,0 MB')
    expect(formatBytes(1024 * 1024)).toBe('1,0 MB')
    expect(formatBytes(5.5 * 1024 * 1024)).toBe('5,5 MB')
  })

  it('uses the German decimal comma', () => {
    expect(formatBytes(2_600_000)).toContain(',')
    expect(formatBytes(2_600_000)).not.toContain('.')
  })

  it('does not print nonsense for empty or invalid input', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(-5)).toBe('0 B')
    expect(formatBytes(Number.NaN)).toBe('0 B')
  })
})
