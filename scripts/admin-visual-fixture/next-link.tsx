import type { AnchorHTMLAttributes, ReactNode } from 'react';

export default function Link({ children, href, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { children?: ReactNode }) {
  return <a href={href} {...props}>{children}</a>;
}
