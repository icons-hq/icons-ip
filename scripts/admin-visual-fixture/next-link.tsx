import type { AnchorHTMLAttributes, ReactNode } from 'react';
import type { LinkProps } from 'next/link';

const NEXT_ONLY_PROPS = ['as', 'replace', 'scroll', 'shallow', 'passHref', 'prefetch', 'locale', 'legacyBehavior', 'onNavigate', 'transitionTypes'] as const;
type FixtureLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & Pick<LinkProps, typeof NEXT_ONLY_PROPS[number]> & { children?: ReactNode };

export default function Link({ children, href, ...props }: FixtureLinkProps) {
  for (const key of NEXT_ONLY_PROPS) delete props[key];
  return <a href={href} {...props}>{children}</a>;
}
