export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // fall through to legacy path
  }
  const ta = document.createElement('textarea')
  try {
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    // ⚠️ `finally`, not a line after the copy: `execCommand` THROWS in a
    // sandboxed iframe (no allow-clipboard-write) rather than returning false,
    // and the old code skipped the removal on that path — every failed copy
    // left an invisible textarea on the page for good. Found by writing the
    // test for the throwing path.
    ta.remove()
  }
}

export function vibrate(pattern: number | number[] = 10): void {
  try {
    navigator.vibrate?.(pattern)
  } catch {
    /* not supported */
  }
}
