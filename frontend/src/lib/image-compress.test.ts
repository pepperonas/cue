import { describe, expect, it } from 'vitest'
import { keepEncoded, shouldCompress, targetSize, webpName } from './image-compress'

describe('shouldCompress', () => {
  it('takes the image types a screenshot arrives as', () => {
    for (const t of ['image/png', 'image/jpeg', 'image/webp', 'image/avif', 'IMAGE/PNG']) {
      expect(shouldCompress(t), t).toBe(true)
    }
  })

  it('leaves GIFs alone', () => {
    // A canvas keeps a single frame, so re-encoding an animation would quietly
    // deliver a still image instead.
    expect(shouldCompress('image/gif')).toBe(false)
  })

  it('ignores anything that is not an image', () => {
    expect(shouldCompress('application/pdf')).toBe(false)
    expect(shouldCompress('')).toBe(false)
  })
})

describe('targetSize', () => {
  it('scales the longest edge down and keeps the ratio', () => {
    expect(targetSize(2400, 1422, 2048)).toEqual({ width: 2048, height: 1213 })
    expect(targetSize(1422, 2400, 2048)).toEqual({ width: 1213, height: 2048 })
  })

  it('leaves an image that already fits untouched', () => {
    expect(targetSize(1280, 900, 2048)).toEqual({ width: 1280, height: 900 })
    expect(targetSize(2048, 100, 2048)).toEqual({ width: 2048, height: 100 })
  })

  it('never enlarges', () => {
    // Upscaling costs bytes and adds no detail.
    const { width, height } = targetSize(200, 100, 2048)
    expect(width).toBe(200)
    expect(height).toBe(100)
  })

  it('keeps an extreme aspect ratio at least one pixel tall', () => {
    expect(targetSize(8000, 3, 2048).height).toBeGreaterThanOrEqual(1)
  })

  it('survives a zero-sized source', () => {
    expect(targetSize(0, 0, 2048)).toEqual({ width: 0, height: 0 })
  })
})

describe('keepEncoded', () => {
  it('keeps a smaller WebP', () => {
    expect(keepEncoded(193_533, 45_000, 'image/webp')).toBe(true)
  })

  it('rejects a result that is not WebP', () => {
    // `canvas.toBlob` falls back to PNG WITHOUT ERROR when it cannot encode the
    // requested type. Measured on a 193 KB screenshot, that PNG came back at
    // 307 KB — the "optimization" would have made the file 1.6x bigger.
    expect(keepEncoded(193_533, 314_368, 'image/png')).toBe(false)
    // Even a smaller non-WebP is refused: the type guard is what tells us the
    // encoder did what we asked, and the size is not the only thing at stake.
    expect(keepEncoded(193_533, 10_000, 'image/png')).toBe(false)
  })

  it('rejects a result that is not smaller', () => {
    // An already well-compressed source (a small WebP, a JPEG photo) can come
    // back larger; then the original is simply the better file.
    expect(keepEncoded(20_000, 20_000, 'image/webp')).toBe(false)
    expect(keepEncoded(20_000, 26_000, 'image/webp')).toBe(false)
  })

  it('rejects an empty blob', () => {
    expect(keepEncoded(20_000, 0, 'image/webp')).toBe(false)
  })
})

describe('webpName', () => {
  it('swaps the extension', () => {
    expect(webpName('screenshot.png')).toBe('screenshot.webp')
    // A real macOS screenshot name carries dots of its own — only the last
    // extension may go.
    expect(webpName('Bildschirmfoto 2026-08-04 um 22.15.30.png')).toBe(
      'Bildschirmfoto 2026-08-04 um 22.15.30.webp',
    )
  })

  it('appends one when there is none', () => {
    expect(webpName('clipboard')).toBe('clipboard.webp')
  })

  it('falls back to a name for an empty or extension-only input', () => {
    expect(webpName('')).toBe('screenshot.webp')
    expect(webpName('.png')).toBe('screenshot.webp')
  })
})
