// Platform detection for keyboard-hint rendering (tested in vitest).

/** True on macOS/iOS — the save shortcut is shown as ⌘↵ there, Strg+↵ elsewhere.
 * The handlers themselves accept BOTH modifiers on every platform (harmless,
 * and a system-wide macOS shortcut hijacking Cmd+Enter keeps Ctrl as fallback). */
export function detectMac(platform?: string): boolean {
  const p =
    platform ??
    (typeof navigator !== 'undefined'
      ? // userAgentData is the modern source; navigator.platform the fallback.
        ((navigator as { userAgentData?: { platform?: string } }).userAgentData?.platform ??
        navigator.platform ??
        '')
      : '')
  return /mac|iphone|ipad|ipod/i.test(p)
}

export const IS_MAC = detectMac()
