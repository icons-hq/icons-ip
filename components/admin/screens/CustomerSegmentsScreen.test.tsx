import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/app/admin/customer-segment-actions', () => ({ archiveCustomerSegmentsAction: vi.fn(), favoriteCustomerSegmentAction: vi.fn() }));
import { normalizeSegmentFilters } from '@/lib/admin/customer-segments';
import { CustomerSegmentsScreen } from './CustomerSegmentsScreen';

/* kit Button은 type을 주지 않으면 type="button"이라 폼을 제출하지 않는다 — 세그먼트 목록 조회(GET 폼)의 조회 버튼만 제출하고,
   선택 삭제는 확인 단계를 거치도록 제출하지 않는 버튼인지 지킨다. 조회 키는 그대로다. */
it('세그먼트 목록 조회는 같은 조회 키로 GET 폼을 제출한다', () => {
  const html = renderToStaticMarkup(<CustomerSegmentsScreen
    data={{ rows: [], favorites: [], total: 0, filters: normalizeSegmentFilters({ q: '장바구니', favorite: '1' }) }}
    overview={{ checkedAt: '2026-11-06T00:00:00.000Z', groups: { potential: null, visitor: 3, interested: 2, buyer: 1, loyal: 0 }, firstPurchaseMembers: 4, memberCount: 9 }}
  />);
  expect(html).toMatch(/<button[^>]*type="submit"[^>]*>조회<\/button>/);
  expect(html).toMatch(/<button[^>]*type="button"[^>]*>선택 삭제<\/button>/);
  for (const name of ['group', 'target', 'kind', 'q', 'favorite', 'pageSize']) expect(html).toContain(`name="${name}"`);
  expect(html).toContain('value="장바구니"');
  expect(html).toMatch(/<input type="checkbox" name="favorite" checked="" value="1"\/>/);
  expect(html).toContain('조건에 맞는 세그먼트가 없습니다.');
});

/* 수집이 꺼져 못 세는 줄과 아직 안 세어 본 줄이 똑같이 회색 '미집계'면 쓸 수 있는 세그먼트가 안 갈린다 — 앞은 고객수 칸의 주의 배지, 뒤는 조용한 글자다. */
it('수집이 꺼져 못 세는 줄, 아직 안 세어 본 줄, 대상을 확인할 줄을 구분한다', () => {
  const at = '2026-11-06T00:00:00.000Z';
  const base = { name: '세그먼트', presetKey: 'preset', ruleVersion: 1, rule: {}, ruleHash: 'a', revision: 1, available: false, favorite: false, estimate: null, createdAt: at, updatedAt: at };
  const rows = [{ ...base, id: 'a', reference: 1, target: 'video_viewed', group: 'interested' }, { ...base, id: 'b', reference: 2, target: 'purchased', group: 'buyer' }, { ...base, id: 'c', reference: 3, target: 'repeat_purchase', group: 'loyal', available: true }];
  const html = renderToStaticMarkup(<CustomerSegmentsScreen
    data={{ rows, favorites: [], total: 3, filters: normalizeSegmentFilters({}) } as unknown as Parameters<typeof CustomerSegmentsScreen>[0]['data']}
    overview={{ checkedAt: at, groups: { potential: null, visitor: null, interested: 2, buyer: 1, loyal: 0 }, firstPurchaseMembers: 4, memberCount: 9 }}
  />);
  expect(html.match(/선택 대상 확인 필요/g)).toHaveLength(1);
  expect(html.match(/data-tone="warning"[^>]*>수집 꺼짐</g)).toHaveLength(1);
  expect(html).not.toContain('CSG-1 · 기본 · 수집 꺼짐');
  /* 표의 미집계는 두 줄(대상 확인·아직 안 셈)의 고객수·동의 칸이고, 수집 꺼짐 줄에는 없다. */
  expect(html.match(/<td[^>]*text-muted-foreground[^>]*>미집계</g)).toHaveLength(4);
  expect(html).toContain('미집계 · 수집을 켜면 집계됩니다');
  expect(html).not.toMatch(/<details(?=[^>]*data-cs-search="")(?=[^>]*\sopen="")/);
  /* 같은 줄의 버튼은 같은 모양이다. */
  expect(html.match(/<a(?=[^>]*border-border-strong)[^>]*>조건 재사용<\/a>/g)).toHaveLength(3);
});
