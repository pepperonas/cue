// Re-encode an image in the browser before uploading it.
//
// A macOS Retina screenshot is a 2–8 MB PNG; as WebP at a sane edge length it
// is a few dozen KB. Doing it client-side means the bytes never travel and the
// server needs no image library.
//
// The decision rules live apart from the canvas work because every one of them
// exists for a measured reason (see `keepEncoded`), and rules with reasons are
// worth testing.

export interface CompressOptions {
  /** Longest edge of the stored image. Larger images are scaled down. */
  maxEdge: number
  /** WebP quality, 0..1. */
  quality: number
}

export const DEFAULT_COMPRESSION: CompressOptions = { maxEdge: 2048, quality: 0.85 }

const TARGET_TYPE = 'image/webp'

/** Images we hand to the canvas. GIFs are excluded: a canvas keeps one frame,
 *  so re-encoding would silently throw away the animation. */
export function shouldCompress(type: string): boolean {
  const t = type.toLowerCase()
  return t.startsWith('image/') && t !== 'image/gif'
}

/** Scale to fit `maxEdge`, keeping the aspect ratio. Never enlarges — blowing a
 *  small image up would cost bytes and add nothing. */
export function targetSize(
  width: number,
  height: number,
  maxEdge: number,
): { width: number; height: number } {
  const longest = Math.max(width, height)
  if (longest <= maxEdge || longest === 0) return { width, height }
  const scale = maxEdge / longest
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

/** Whether the re-encoded blob is worth keeping over the original.
 *
 * Two guards, both from measurement:
 * - **It must actually be WebP.** `canvas.toBlob` falls back to PNG without a
 *   word when it cannot encode the requested type, and a canvas PNG of a
 *   screenshot measured 1.6× LARGER than the PNG it came from.
 * - **It must be smaller.** An image that is already well compressed (a small
 *   WebP, a photo saved as JPEG) can come back bigger, and then the original
 *   is simply the better file.
 */
export function keepEncoded(originalBytes: number, encodedBytes: number, encodedType: string): boolean {
  if (encodedType.toLowerCase() !== TARGET_TYPE) return false
  return encodedBytes > 0 && encodedBytes < originalBytes
}

/** `screenshot.png` → `screenshot.webp` (the server derives the stored
 *  extension from the name). */
export function webpName(name: string): string {
  const base = name.replace(/\.[^./\\]*$/, '')
  return `${base || 'screenshot'}.webp`
}

/**
 * Returns a smaller WebP version of `file`, or `file` itself when re-encoding
 * is impossible, unsupported or simply not an improvement. Never throws — a
 * failed optimization must not cost the user their screenshot.
 */
export async function compressImage(
  file: File,
  opts: CompressOptions = DEFAULT_COMPRESSION,
): Promise<File> {
  if (!shouldCompress(file.type)) return file
  try {
    // `from-image` so a photo with EXIF orientation is not rotated by the
    // re-encode (a screenshot has none, a phone picture does).
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    const { width, height } = targetSize(bitmap.width, bitmap.height, opts.maxEdge)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(bitmap, 0, 0, width, height)
    bitmap.close?.()
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, TARGET_TYPE, opts.quality),
    )
    if (!blob || !keepEncoded(file.size, blob.size, blob.type)) return file
    return new File([blob], webpName(file.name), { type: TARGET_TYPE })
  } catch {
    return file
  }
}
