// MD3 Expressive spring presets for `motion`. Spatial springs for movement,
// emphasized easing for non-spatial. All consumers must respect reduced-motion.
import type { Transition } from 'motion/react'

export const springs = {
  // Spatial — for position/size/layout changes (cards, FAB, sheets).
  spatial: { type: 'spring', stiffness: 380, damping: 32, mass: 0.9 } as Transition,
  spatialFast: { type: 'spring', stiffness: 520, damping: 34, mass: 0.7 } as Transition,
  // Bouncy — playful overshoot for entrance / drop.
  bouncy: { type: 'spring', stiffness: 320, damping: 20, mass: 0.9 } as Transition,
  // Gentle — settling, snap-back after drag.
  gentle: { type: 'spring', stiffness: 260, damping: 30 } as Transition,
}

// MD3 emphasized easing for opacity / color (non-spatial).
export const emphasized: Transition = { duration: 0.4, ease: [0.2, 0, 0, 1] }

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

// Staggered card entrance variants.
export const cardEnter = {
  hidden: { opacity: 0, y: 14, scale: 0.97 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { ...springs.bouncy, delay: Math.min(i * 0.035, 0.3) },
  }),
}
