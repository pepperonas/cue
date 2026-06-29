import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from 'react'
import { motion } from 'motion/react'
import { springs } from '../lib/motion'

export function Icon({
  name,
  className,
  style,
}: {
  name: string
  className?: string
  style?: CSSProperties
}) {
  return (
    <span className={`material-symbols-rounded ${className ?? ''}`} style={style}>
      {name}
    </span>
  )
}

interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'filled' | 'tonal' | 'outlined' | 'text' | 'danger'
  icon?: string
  children?: ReactNode
}

export function Button({ variant = 'filled', icon, children, className, ...rest }: BtnProps) {
  return (
    <button className={`btn btn--${variant} ${className ?? ''}`} {...rest}>
      {icon && <Icon name={icon} />}
      {children}
    </button>
  )
}

export function IconButton({
  icon,
  label,
  className,
  ...rest
}: { icon: string; label: string } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={`icon-btn ${className ?? ''}`} aria-label={label} title={label} {...rest}>
      <Icon name={icon} />
    </button>
  )
}

export function Switch({
  on,
  onChange,
  label,
}: {
  on: boolean
  onChange: (v: boolean) => void
  label: string
}) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      className="switch"
      data-on={on}
      onClick={() => onChange(!on)}
    >
      <motion.span className="knob" layout transition={springs.spatialFast} />
    </button>
  )
}

export function Footer() {
  return <footer className="footer">© 2026 Martin Pfeffer | celox.io</footer>
}
