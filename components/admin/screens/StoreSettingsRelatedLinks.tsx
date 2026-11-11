import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { buttonVariants } from '@/components/admin/kit/ui/button';

/**
 * 다른 화면으로 나가는 링크 줄. 이 화면 안을 전환하는 탭과 헷갈리지 않게 테두리 없는 작은 글자에 나가는 화살표를 붙인다.
 */
export function StoreSettingsRelatedLinks({ label, links }: { label: string; links: { href: string; label: string }[] }) {
  return <nav aria-label={label} className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5 text-xs text-muted-foreground" data-related-links="">
    <span className="mr-1">관련 화면</span>
    {links.map(link => <Link className={`${buttonVariants({ variant: 'ghost', size: 'xs' })} font-normal text-muted-foreground`} data-slot="button" href={link.href} key={link.href}>{link.label}<ArrowUpRight aria-hidden="true" /></Link>)}
  </nav>;
}
