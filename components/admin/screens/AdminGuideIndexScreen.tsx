import Link from 'next/link';
import { ArrowRight, BarChart3, BellRing, ContactRound, Gamepad2, Landmark, LifeBuoy, Megaphone, MessageSquareText, Package, Rocket, Settings, Ticket, Truck, Undo2, Wrench, type LucideIcon } from 'lucide-react';
import { AdminStatusBadge } from '@/components/admin/console/AdminKit';
import { Card, CardContent, CardHeader } from '@/components/admin/kit/ui/card';
import { ADMIN_WEEKLY_CHANGES } from '@/lib/admin/guide/changes';
import type { AdminGuideTopicSlug } from '@/lib/admin/guide/types';
import {
  ADMIN_GUIDE_TOPIC_SLUGS,
  ADMIN_GUIDE_TOPICS,
  ADMIN_GUIDE_UPDATED_AT,
  adminGuideTopicHref,
} from '@/lib/admin/guide/topics';

/*
 * 어드민 사용 가이드 — 목차 화면.
 *
 * 전체 주제를 순서대로 카드로 편다. 사이드바에는 이 목차 하나만 올라가므로
 * (lib/admin/navigation.ts), 주제 탐색은 여기와 주제 페이지의 이전/다음이 맡는다.
 */

/* 처음 온 운영자가 실무 순서대로 밟는 추천 경로. slug는 레지스트리와 테스트가 지킨다. */
const START_PATH = ['getting-started', 'goods-sales', 'orders-shipping'] as const;

/* 주제 카드를 글자를 읽기 전에 그림으로 가른다. */
const TOPIC_ICONS: Record<AdminGuideTopicSlug, LucideIcon> = {
  'whats-new': BellRing,
  'getting-started': Rocket,
  'goods-sales': Package,
  'orders-shipping': Truck,
  'bank-transfer': Landmark,
  claims: Undo2,
  'inquiries-reviews': MessageSquareText,
  'cards-games': Gamepad2,
  'events-tickets': Ticket,
  'display-messaging': Megaphone,
  'members-roles': ContactRound,
  'store-settings': Settings,
  stats: BarChart3,
  troubleshooting: LifeBuoy,
  'dev-requests': Wrench,
};

export function AdminGuideIndexScreen() {
  const latestChange = ADMIN_WEEKLY_CHANGES[0]?.week;
  return (
    <div className="flex min-w-0 flex-col gap-4" data-guide="index">
      <Card className="min-w-0">
        <CardHeader>
          <h2 className="text-lg leading-tight font-semibold tracking-tight">주제별 안내</h2>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm leading-relaxed">
          <p>
            상품 등록부터 주문·출고·고객 응대·정산까지 현재 판매자센터의 처리 절차를 안내합니다.
            업무별 입력·저장·완료 조건과 파일 양식, 처리할 수 없는 경우를 확인하세요.
          </p>
          <p className="text-muted-foreground">전체 {ADMIN_GUIDE_TOPIC_SLUGS.length}개 주제 · 최종 확인 <time className="tabular-nums" dateTime={ADMIN_GUIDE_UPDATED_AT}>{ADMIN_GUIDE_UPDATED_AT}</time> · 화면과 저장 권한은 매니저 역할에 따라 다릅니다.</p>
          <p className="pt-2 font-medium">처음이라면 이 순서를 권합니다.</p>
          <ol className="flex flex-wrap gap-2">
            {START_PATH.map((slug, index) => (
              <li key={slug}>
                <Link className="inline-flex min-h-9 items-center gap-2 rounded-lg border bg-background px-3 text-sm font-medium transition-colors hover:bg-muted" href={adminGuideTopicHref(slug)}>
                  <span aria-hidden="true" className="flex size-5 items-center justify-center rounded-full bg-muted text-xs text-muted-foreground tabular-nums">{index + 1}</span>
                  {ADMIN_GUIDE_TOPICS[slug].navLabel}
                </Link>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <nav aria-label="가이드 주제" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {ADMIN_GUIDE_TOPIC_SLUGS.map((slug, index) => {
          const topic = ADMIN_GUIDE_TOPICS[slug];
          const Icon = TOPIC_ICONS[slug];
          return (
            <Link
              className="group/topic flex min-w-0 flex-col gap-1.5 rounded-xl bg-card p-4 text-card-foreground ring-1 ring-foreground/10 transition-colors hover:bg-muted/50"
              href={adminGuideTopicHref(slug)}
              key={slug}
            >
              <span className="flex items-center justify-between gap-2 text-xs text-muted-foreground tabular-nums">
                <span className="inline-flex items-center gap-2">
                  <span aria-hidden="true" className="grid size-8 place-items-center rounded-lg bg-muted text-secondary-foreground"><Icon className="size-4" /></span>
                  {String(index + 1).padStart(2, '0')}
                </span>
                <ArrowRight aria-hidden="true" className="size-4 transition-transform group-hover/topic:translate-x-0.5 group-hover/topic:text-foreground" />
              </span>
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-base font-semibold">
                {topic.navLabel}
                {slug === 'whats-new' && latestChange ? <AdminStatusBadge tone="info">최근 {latestChange}</AdminStatusBadge> : null}
              </span>
              <span className="text-sm leading-normal text-muted-foreground">{topic.summary}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
