// Small display formatters shared by the UI. Pure, so they can be tested.

/**
 * Human-readable byte size, German decimal comma.
 *
 * The rounding happens BEFORE the unit is chosen: 1023,7 KB must read as
 * "1,0 MB", not "1024 KB", which is what comparing the unrounded value gives.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  if (bytes < 1024) return `${Math.round(bytes)} B`
  const kb = bytes / 1024
  if (Math.round(kb) < 1024) return `${Math.round(kb)} KB`
  return `${(kb / 1024).toFixed(1).replace('.', ',')} MB`
}
