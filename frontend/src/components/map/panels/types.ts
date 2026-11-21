import type { CSSProperties } from 'react'

/** Props communes des panneaux posés sur la carte (position fournie par la carte). */
export interface PanelProps {
  onClose: () => void
  style?: CSSProperties
  className?: string
}
