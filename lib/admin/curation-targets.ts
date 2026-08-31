/*
 * 홈 큐레이션이 가리킬 수 있는 실재 목적지 (#183).
 *
 * 운영자가 `/ip/rilakkuma` 같은 경로를 손으로 적으면 오타 하나가 404가 된다.
 * 실재하는 화면과 카탈로그 레코드에서 목록을 만들어 고르게 한다.
 */

import { goodDetailHref } from '@/lib/goods-display';

export interface AdminCurationTargetOption {
  label: string;
  path: string;
}

export interface AdminCurationTargetGroup {
  label: string;
  options: AdminCurationTargetOption[];
}

export interface AdminCurationTargetRecord {
  id: string;
  title: string;
  archivedAt: string | null;
}

export interface AdminCurationTargetSource {
  events: readonly AdminCurationTargetRecord[];
  goods: readonly AdminCurationTargetRecord[];
  ips: readonly AdminCurationTargetRecord[];
}

/* 고정 화면은 라우트가 코드에 있으므로 항상 실재한다. */
const FIXED_TARGETS: AdminCurationTargetOption[] = [
  { label: '홈', path: '/' },
  { label: 'IP 허브', path: '/ip' },
  { label: '굿즈샵', path: '/shop' },
  { label: '카드팩', path: '/packs' },
  { label: '오프라인 팝업', path: '/offline-popups' },
  { label: '커뮤니티', path: '/community' },
];

/* 경로 조립은 호출부가 넘긴다 — 굿즈처럼 이미 헬퍼가 있는 대상은 그것을 쓴다. */
function detailOptions(
  records: readonly AdminCurationTargetRecord[],
  href: (id: string) => string,
): AdminCurationTargetOption[] {
  return records
    .filter((record) => !record.archivedAt)
    .map((record) => ({ label: `${record.title} (${record.id})`, path: href(record.id) }));
}

export function adminCurationTargetGroups(
  source: AdminCurationTargetSource,
): AdminCurationTargetGroup[] {
  return [
    { label: '주요 화면', options: FIXED_TARGETS },
    { label: 'IP 상세', options: detailOptions(source.ips, (id) => `/ip/${id}`) },
    /* 굿즈 상세가 빠지면 첫 판매 굿즈를 홈에서 상세로 바로 보낼 수 없다. */
    { label: '굿즈 상세', options: detailOptions(source.goods, goodDetailHref) },
    { label: '오프라인 팝업 상세', options: detailOptions(source.events, (id) => `/offline-popups/${id}`) },
  ].filter((group) => group.options.length > 0);
}

/*
 * 보관됐거나 지워진 대상을 가리키던 기존 큐레이션도 자기 값을 유지해야 한다.
 * 목록에 없으면 "현재 값" 그룹으로 따로 얹는다 — 조용히 홈으로 바뀌면 안 된다.
 */
export function adminCurationTargetGroupsFor(
  source: AdminCurationTargetSource,
  currentPath: string | null,
): AdminCurationTargetGroup[] {
  const groups = adminCurationTargetGroups(source);
  if (!currentPath) return groups;

  const known = groups.some((group) => group.options.some((option) => option.path === currentPath));
  if (known) return groups;

  return [{ label: '현재 값', options: [{ label: currentPath, path: currentPath }] }, ...groups];
}
