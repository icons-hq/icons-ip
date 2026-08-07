/*
 * 어드민 섹션 식별자.
 *
 * 화면(components/admin/Admin.tsx)이 아니라 여기에 두는 이유는 서버 컴포넌트인
 * app/admin/page.tsx 가 ?section= 를 해석해야 하기 때문이다. 'use client' 모듈에서
 * 로직을 가져오면 클라이언트 경계가 서버 렌더 경로에 끌려 들어온다.
 */

export type AdminSection =
  | 'overview'
  | 'orders'
  | 'ip'
  | 'good'
  | 'card'
  | 'pool'
  | 'policy'
  | 'grants'
  | 'game'
  | 'event'
  | 'ticket'
  | 'curations'
  | 'notifications'
  | 'emails'
  | 'moderation'
  | 'members'
  | 'roles';

/*
 * ?section= 딥링크가 열 수 있는 섹션.
 *
 * 목록으로 두는 이유는 새 섹션을 union 에만 추가하면 링크가 조용히 개요로
 * 떨어지기 때문이다 — 실제로 '메일 발송 이력'이 그렇게 빠져 있었다.
 * 상세 레코드를 선택해야 의미가 있는 섹션(ip·card·event)과 권한이 갈리는
 * roles·moderation 은 의도적으로 뺀다.
 */
const DEEP_LINKABLE_SECTIONS = new Set<AdminSection>([
  'orders',
  'good',
  'pool',
  'policy',
  'grants',
  'game',
  'ticket',
  'curations',
  'notifications',
  'emails',
  'members',
]);

export function adminSectionFromQuery(value: unknown): AdminSection {
  return typeof value === 'string' && DEEP_LINKABLE_SECTIONS.has(value as AdminSection)
    ? (value as AdminSection)
    : 'overview';
}
