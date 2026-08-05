import { afterEach, describe, expect, it, vi } from 'vitest'
import { compressImage, keepEncoded, shouldCompress, targetSize, webpName } from './image-compress'

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

// ----------------------------------------------------------------------
// compressImage itself. The rules above are pure; these pin that the
// orchestration around the canvas actually applies them — which is where a
// screenshot would be lost if it went wrong.
// ----------------------------------------------------------------------

function file(name: string, type: string, bytes: number): File {
  return new File([new Uint8Array(bytes)], name, { type })
}

interface CanvasStub {
  drawn: { width: number; height: number }[]
  asked: { type: string; quality: number }[]
}

function stubCanvas(source: { width: number; height: number }, result: Blob | null): CanvasStub {
  const stub: CanvasStub = { drawn: [], asked: [] }
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => ({ ...source, close: vi.fn() })),
  )
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: (_img: unknown, _x: number, _y: number, width: number, height: number) =>
      stub.drawn.push({ width, height }),
  } as unknown as CanvasRenderingContext2D)
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(
    (cb: BlobCallback, type?: string, quality?: number) => {
      stub.asked.push({ type: type ?? '', quality: quality ?? -1 })
      cb(result)
    },
  )
  return stub
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('compressImage', () => {
  it('returns a smaller WebP, scaled to the cap, named .webp', async () => {
    const stub = stubCanvas(
      { width: 2400, height: 1422 },
      new Blob([new Uint8Array(45_000)], { type: 'image/webp' }),
    )
    const out = await compressImage(file('shot.png', 'image/png', 193_533))

    expect(out.type).toBe('image/webp')
    expect(out.name).toBe('shot.webp')
    expect(out.size).toBe(45_000)
    expect(stub.drawn).toEqual([{ width: 2048, height: 1213 }])
    expect(stub.asked).toEqual([{ type: 'image/webp', quality: 0.85 }])
  })

  it('keeps the original when the encoder silently fell back to PNG', async () => {
    // `canvas.toBlob` does this WITHOUT an error when it cannot encode the
    // requested type. The blob here is deliberately SMALLER than the source, so
    // only the type check can reject it — with a larger one (what the 193 KB
    // screenshot actually produced: 307 KB) the size rule would catch it and
    // this test would pass without proving anything.
    stubCanvas(
      { width: 2400, height: 1422 },
      new Blob([new Uint8Array(100_000)], { type: 'image/png' }),
    )
    const original = file('shot.png', 'image/png', 193_533)
    expect(await compressImage(original)).toBe(original)
  })

  it('keeps the original when the re-encode is not smaller', async () => {
    stubCanvas({ width: 64, height: 64 }, new Blob([new Uint8Array(9_000)], { type: 'image/webp' }))
    const original = file('tiny.png', 'image/png', 70)
    expect(await compressImage(original)).toBe(original)
  })

  it('keeps the original when the encoder hands back nothing', async () => {
    stubCanvas({ width: 800, height: 600 }, null)
    const original = file('shot.png', 'image/png', 5_000)
    expect(await compressImage(original)).toBe(original)
  })

  it('keeps the original when the image cannot be decoded at all', async () => {
    // The catch-all. A failed optimization must never cost the user the file.
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => {
        throw new Error('decode failed')
      }),
    )
    const original = file('broken.png', 'image/png', 5_000)
    expect(await compressImage(original)).toBe(original)
  })

  it('never touches the canvas for a GIF', async () => {
    // Not just "returns the original": the canvas must not run at all, because
    // drawing an animation into one keeps a single frame.
    const created = vi.spyOn(document, 'createElement')
    const original = file('anim.gif', 'image/gif', 500_000)
    expect(await compressImage(original)).toBe(original)
    expect(created).not.toHaveBeenCalled()
  })

  it('honours a custom cap and quality', async () => {
    const stub = stubCanvas(
      { width: 4000, height: 1000 },
      new Blob([new Uint8Array(100)], { type: 'image/webp' }),
    )
    await compressImage(file('wide.png', 'image/png', 900_000), { maxEdge: 1600, quality: 0.6 })
    expect(stub.drawn).toEqual([{ width: 1600, height: 400 }])
    expect(stub.asked[0].quality).toBe(0.6)
  })
})

describe('compressImage without a drawing context', () => {
  it('keeps the original when the canvas hands back no 2D context', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ width: 800, height: 600, close: vi.fn() })),
    )
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const original = file('shot.png', 'image/png', 5_000)
    expect(await compressImage(original)).toBe(original)
  })
})
