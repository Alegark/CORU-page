import type { AnchorHTMLAttributes, MouseEvent, ReactNode } from 'react'
import { handleSpaNavigate } from '../../app/router'

type Props = AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string
  children?: ReactNode
}

/** Same-origin SPA link: unmodified primary click uses history; modifiers keep native behavior. */
export function Link({ href, onClick, children, ...rest }: Props) {
  return (
    <a
      href={href}
      {...rest}
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        onClick?.(event)
        if (event.defaultPrevented) return
        handleSpaNavigate(event, href)
      }}
    >
      {children}
    </a>
  )
}
