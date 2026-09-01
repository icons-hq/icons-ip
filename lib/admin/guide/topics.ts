import { BANK_TRANSFER_TOPIC } from './topics/bank-transfer';
import { CARDS_GAMES_TOPIC } from './topics/cards-games';
import { CLAIMS_TOPIC } from './topics/claims';
import { DEV_REQUESTS_TOPIC } from './topics/dev-requests';
import { DISPLAY_MESSAGING_TOPIC } from './topics/display-messaging';
import { EVENTS_TICKETS_TOPIC } from './topics/events-tickets';
import { GETTING_STARTED_TOPIC } from './topics/getting-started';
import { GOODS_SALES_TOPIC } from './topics/goods-sales';
import { INQUIRIES_REVIEWS_TOPIC } from './topics/inquiries-reviews';
import { MEMBERS_ROLES_TOPIC } from './topics/members-roles';
import { ORDERS_SHIPPING_TOPIC } from './topics/orders-shipping';
import { PROMOTIONS_TOPIC } from './topics/promotions';
import { STATS_TOPIC } from './topics/stats';
import { TROUBLESHOOTING_TOPIC } from './topics/troubleshooting';
import type { AdminGuideTopic, AdminGuideTopicSlug } from './types';

export type { AdminGuideTopic, AdminGuideTopicSlug };

/** 인덱스 카드와 이전/다음 내비가 따르는 열람 순서. */
export const ADMIN_GUIDE_TOPIC_SLUGS: readonly AdminGuideTopicSlug[] = [
  'getting-started',
  'goods-sales',
  'orders-shipping',
  'bank-transfer',
  'claims',
  'inquiries-reviews',
  'cards-games',
  'events-tickets',
  'display-messaging',
  'promotions',
  'members-roles',
  'stats',
  'troubleshooting',
  'dev-requests',
];

export const ADMIN_GUIDE_TOPICS: Record<AdminGuideTopicSlug, AdminGuideTopic> = {
  'getting-started': GETTING_STARTED_TOPIC,
  'goods-sales': GOODS_SALES_TOPIC,
  'orders-shipping': ORDERS_SHIPPING_TOPIC,
  'bank-transfer': BANK_TRANSFER_TOPIC,
  claims: CLAIMS_TOPIC,
  'inquiries-reviews': INQUIRIES_REVIEWS_TOPIC,
  'cards-games': CARDS_GAMES_TOPIC,
  'events-tickets': EVENTS_TICKETS_TOPIC,
  'display-messaging': DISPLAY_MESSAGING_TOPIC,
  promotions: PROMOTIONS_TOPIC,
  'members-roles': MEMBERS_ROLES_TOPIC,
  stats: STATS_TOPIC,
  troubleshooting: TROUBLESHOOTING_TOPIC,
  'dev-requests': DEV_REQUESTS_TOPIC,
};

/*
 * URL 파라미터는 어떤 문자열이든 들어온다. includes 가드를 지나야만 레코드를 여는
 * 이유는 '__proto__' 같은 값이 프로토타입 체인을 타고 엉뚱한 것을 돌려주지 않게
 * 하기 위해서다 — 법정 고지(lib/legal/documents.ts)와 같은 규율이다.
 * sync를 유지한다: 라우트가 게이트(requireAdminScreenAccess) 다음에 부르는 조회라서
 * async가 되면 게이트 순서 검사(shell-route-guards.test.ts)와 얽힌다.
 */
export function getAdminGuideTopic(slug: string): AdminGuideTopic | null {
  return (ADMIN_GUIDE_TOPIC_SLUGS as readonly string[]).includes(slug)
    ? ADMIN_GUIDE_TOPICS[slug as AdminGuideTopicSlug]
    : null;
}

export function adminGuideTopicHref(slug: AdminGuideTopicSlug): string {
  return `/admin/guide/${slug}`;
}

/** 이전/다음 내비. 순서 배열의 이웃을 돌려주고 끝에서는 null. */
export function adjacentAdminGuideTopics(slug: AdminGuideTopicSlug): {
  previous: AdminGuideTopic | null;
  next: AdminGuideTopic | null;
} {
  const index = ADMIN_GUIDE_TOPIC_SLUGS.indexOf(slug);
  return {
    previous: index > 0 ? ADMIN_GUIDE_TOPICS[ADMIN_GUIDE_TOPIC_SLUGS[index - 1]] : null,
    next: index >= 0 && index < ADMIN_GUIDE_TOPIC_SLUGS.length - 1
      ? ADMIN_GUIDE_TOPICS[ADMIN_GUIDE_TOPIC_SLUGS[index + 1]]
      : null,
  };
}
