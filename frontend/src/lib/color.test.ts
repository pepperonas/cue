import { describe, expect, it } from 'vitest'
import { applyScheme, buildSchemes, PRESET_SEEDS, projectTones } from './color'

const HEX = /^#[0-9a-f]{6}$/

describe('buildSchemes', () => {
  it('produces valid hex values for every role token in both modes', () => {
    const { light, dark } = buildSchemes('#6750A4')
    for (const scheme of [light, dark]) {
      for (const [token, value] of Object.entries(scheme)) {
        expect(value, token).toMatch(HEX)
      }
    }
  })

  it('emits the full MD3 role set symmetrically in light and dark', () => {
    const { light, dark } = buildSchemes('#0B57D0')
    expect(Object.keys(dark).sort()).toEqual(Object.keys(light).sort())
    for (const token of ['primary', 'on-primary', 'surface', 'on-surface', 'error', 'outline']) {
      expect(light[token]).toBeDefined()
    }
  })

  it('dark mode is actually darker than light mode', () => {
    const { light, dark } = buildSchemes('#386A20')
    const lum = (hex: string) => parseInt(hex.slice(1), 16)
    expect(lum(dark.background)).toBeLessThan(lum(light.background))
    expect(lum(dark.surface)).toBeLessThan(lum(light.surface))
  })

  it('accepts 3-digit hex seeds', () => {
    const { light } = buildSchemes('#f00')
    expect(light.primary).toMatch(HEX)
  })

  it('tames extreme seeds: greyscale still yields a usable tinted palette', () => {
    const { light } = buildSchemes('#808080') // zero saturation seed
    expect(light.primary).toMatch(HEX)
    expect(light.primary).not.toBe(light.background)
  })

  it('different seeds produce different primaries', () => {
    expect(buildSchemes('#B3261E').light.primary).not.toBe(
      buildSchemes('#0B57D0').light.primary,
    )
  })
})

describe('projectTones', () => {
  it('returns a container/on/accent triple per mode', () => {
    for (const dark of [true, false]) {
      const tones = projectTones('#006A6A', dark)
      expect(tones.container).toMatch(HEX)
      expect(tones.on).toMatch(HEX)
      expect(tones.accent).toMatch(HEX)
    }
  })

  it('keeps container and on-color far apart (readability)', () => {
    const lum = (hex: string) => {
      const n = parseInt(hex.slice(1), 16)
      return (((n >> 16) & 255) + ((n >> 8) & 255) + (n & 255)) / 3
    }
    for (const seed of PRESET_SEEDS) {
      const light = projectTones(seed, false)
      const dark = projectTones(seed, true)
      expect(Math.abs(lum(light.container) - lum(light.on))).toBeGreaterThan(100)
      expect(Math.abs(lum(dark.container) - lum(dark.on))).toBeGreaterThan(100)
    }
  })
})

describe('applyScheme', () => {
  it('writes each token as an --md-* CSS variable on :root', () => {
    applyScheme({ primary: '#123456', 'on-primary': '#ffffff' })
    const root = document.documentElement
    expect(root.style.getPropertyValue('--md-primary')).toBe('#123456')
    expect(root.style.getPropertyValue('--md-on-primary')).toBe('#ffffff')
  })
})

describe('PRESET_SEEDS', () => {
  it('are unique valid hex colors', () => {
    for (const seed of PRESET_SEEDS) expect(seed).toMatch(/^#[0-9A-Fa-f]{6}$/)
    expect(new Set(PRESET_SEEDS.map((s) => s.toLowerCase())).size).toBe(PRESET_SEEDS.length)
  })
})
