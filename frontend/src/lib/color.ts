// Lightweight Material You tonal-palette generator (no heavy dependency).
// Derives MD3 color roles for light + dark from a single seed hex.
// This is an HSL-tone approximation of HCT — good enough for a tasteful UI.

type RGB = { r: number; g: number; b: number }

function hexToRgb(hex: string): RGB {
  const h = hex.replace('#', '').trim()
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const n = parseInt(full, 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

function rgbToHsl({ r, g, b }: RGB) {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  let h = 0
  const l = (max + min) / 2
  const d = max - min
  let s = 0
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1))
    switch (max) {
      case r:
        h = ((g - b) / d) % 6
        break
      case g:
        h = (b - r) / d + 2
        break
      default:
        h = (r - g) / d + 4
    }
    h *= 60
    if (h < 0) h += 360
  }
  return { h, s, l }
}

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  let r = 0
  let g = 0
  let b = 0
  if (h < 60) [r, g, b] = [c, x, 0]
  else if (h < 120) [r, g, b] = [x, c, 0]
  else if (h < 180) [r, g, b] = [0, c, x]
  else if (h < 240) [r, g, b] = [0, x, c]
  else if (h < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  const to = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${to(r)}${to(g)}${to(b)}`
}

// A tonal palette maps "tone" 0..100 (perceptual lightness) to a hex with the
// palette's hue + chroma. Tone 0 = black, 100 = white.
function tonalPalette(hue: number, sat: number) {
  return (tone: number) => hslToHex(hue, sat, tone / 100)
}

export interface Scheme {
  [token: string]: string
}

export function buildSchemes(seed: string): { light: Scheme; dark: Scheme } {
  const { h, s } = rgbToHsl(hexToRgb(seed))
  const sClamped = Math.min(0.92, Math.max(0.36, s))

  const primary = tonalPalette(h, sClamped)
  const secondary = tonalPalette(h, sClamped * 0.45)
  const tertiary = tonalPalette((h + 60) % 360, sClamped * 0.6)
  const neutral = tonalPalette(h, 0.04)
  const neutralVariant = tonalPalette(h, 0.1)
  const error = tonalPalette(25, 0.75)

  const light: Scheme = {
    primary: primary(40),
    'on-primary': primary(100),
    'primary-container': primary(90),
    'on-primary-container': primary(10),
    secondary: secondary(40),
    'on-secondary': secondary(100),
    'secondary-container': secondary(90),
    'on-secondary-container': secondary(10),
    tertiary: tertiary(40),
    'on-tertiary': tertiary(100),
    'tertiary-container': tertiary(90),
    'on-tertiary-container': tertiary(10),
    error: error(40),
    'on-error': error(100),
    'error-container': error(90),
    'on-error-container': error(10),
    background: neutral(99),
    'on-background': neutral(10),
    surface: neutral(98),
    'on-surface': neutral(10),
    'surface-variant': neutralVariant(90),
    'on-surface-variant': neutralVariant(30),
    'surface-container-lowest': neutral(100),
    'surface-container-low': neutral(96),
    'surface-container': neutral(94),
    'surface-container-high': neutral(92),
    'surface-container-highest': neutral(90),
    outline: neutralVariant(50),
    'outline-variant': neutralVariant(80),
    'inverse-surface': neutral(20),
    'inverse-on-surface': neutral(95),
    'inverse-primary': primary(80),
    shadow: '#000000',
  }

  const dark: Scheme = {
    primary: primary(80),
    'on-primary': primary(20),
    'primary-container': primary(30),
    'on-primary-container': primary(90),
    secondary: secondary(80),
    'on-secondary': secondary(20),
    'secondary-container': secondary(30),
    'on-secondary-container': secondary(90),
    tertiary: tertiary(80),
    'on-tertiary': tertiary(20),
    'tertiary-container': tertiary(30),
    'on-tertiary-container': tertiary(90),
    error: error(80),
    'on-error': error(20),
    'error-container': error(30),
    'on-error-container': error(90),
    background: neutral(6),
    'on-background': neutral(90),
    surface: neutral(6),
    'on-surface': neutral(90),
    'surface-variant': neutralVariant(30),
    'on-surface-variant': neutralVariant(80),
    'surface-container-lowest': neutral(4),
    'surface-container-low': neutral(10),
    'surface-container': neutral(12),
    'surface-container-high': neutral(17),
    'surface-container-highest': neutral(22),
    outline: neutralVariant(60),
    'outline-variant': neutralVariant(30),
    'inverse-surface': neutral(90),
    'inverse-on-surface': neutral(20),
    'inverse-primary': primary(40),
    shadow: '#000000',
  }

  return { light, dark }
}

export function applyScheme(scheme: Scheme) {
  const root = document.documentElement
  for (const [token, value] of Object.entries(scheme)) {
    root.style.setProperty(`--md-${token}`, value)
  }
}

// Returns a tonal pair (container bg + readable on-color) for an arbitrary
// project seed color, respecting the active light/dark mode.
export function projectTones(seed: string, dark: boolean) {
  const { h, s } = rgbToHsl(hexToRgb(seed))
  const sc = Math.min(0.9, Math.max(0.4, s))
  const pal = tonalPalette(h, sc)
  return dark
    ? { container: pal(30), on: pal(90), accent: pal(80) }
    : { container: pal(90), on: pal(10), accent: pal(40) }
}

export const PRESET_SEEDS = [
  '#6750A4', // violet (default)
  '#386A20', // green
  '#0B57D0', // blue
  '#B3261E', // red
  '#7D5260', // mauve
  '#006A6A', // teal
  '#8B5000', // amber
  '#5B5BD6', // indigo
]
