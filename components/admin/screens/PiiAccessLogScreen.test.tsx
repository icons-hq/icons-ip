import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { normalizePiiAccessLogFilters, type PiiAccessLogData } from '@/lib/admin/pii-access-log';
import { PiiAccessLogScreen } from './PiiAccessLogScreen';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => '/admin/settings/access-log', useSearchParams: () => new URLSearchParams() }));

const NOW = new Date('2026-11-18T03:00:00Z');
const ACTOR = 'a9000000-0000-4000-8000-000000000002';
const ORDER = 'a9000000-0000-4000-8000-000000000101';
const data: PiiAccessLogData = {
  from: '2026-10-18', to: '2026-11-18', page: 1, pageSize: 50, total: 2,
  summary: { total: 2, offHours: 1, bulk: 1, burst: 0, flagged: 2 },
  actors: [{ id: ACTOR, name: '점검 합성', count: 2 }],
  items: [
    { id: '2', at: '2026-11-17T14:30:00Z', actorId: ACTOR, actorName: '점검 합성', actorAccess: 'primary', ip: '203.0.113.9', action: 'view', surface: 'order.detail',
      path: `/admin/sales/orders/${ORDER}`, subjectKind: 'order', subjectIds: [ORDER], subjectCount: 1, memberIds: [], memberCount: 1, detail: { via: 'popup' }, flags: ['off_hours'] },
    { id: '1', at: '2026-11-17T05:00:00Z', actorId: ACTOR, actorName: '점검 합성', actorAccess: 'legacy_admin', ip: null, action: 'export', surface: 'export.list',
      path: '/api/admin/list-export', subjectKind: 'shipment', subjectIds: [], subjectCount: 3200, memberIds: [], memberCount: 0, detail: { screen: 'dispatch', rowCount: 3400 }, flags: ['bulk'] },
  ],
};
const render = (filters = normalizePiiAccessLogFilters({}, NOW)) => renderToStaticMarkup(<PiiAccessLogScreen data={data} filters={filters} />);

describe('개인정보 접속기록 점검 화면', () => {
  it('누가·언제·어디서·무엇을·누구의 정보를 처리했는지 보이고, 원문이 아닌 기록이라는 점과 보관·점검 주기를 말한다', () => {
    const html = render();
    for (const label of ['접속일시', '운영자', '접속지(IP)', '수행 업무', '화면', '대상', '이상 징후']) expect(html).toContain(label);
    expect(html).toContain('점검 합성'); expect(html).toContain('계정 주매니저'); expect(html).toContain('호환 단계 관리자');
    expect(html).toContain('203.0.113.9'); expect(html).toContain('확인 불가');
    expect(html).toContain('주문 상세'); expect(html).toContain('목록 엑셀'); expect(html).toContain('배송 건 3,200건');
    expect(html).toContain('개인정보 원문(이름·연락처·주소·검색어)은 남기지 않습니다');
    expect(html).toContain('2년 보관'); expect(html).toContain('한 달에 한 번');
    expect(html).toContain('화면 dispatch · 파일 행 3,400');
  });
  it('이상 징후 칸과 건수 카드가 규칙대로 거르는 주소로 이어지고, 대상 ID는 개인정보 화면이 아니라 점검 필터로 이어진다', () => {
    const html = render();
    expect(html).toContain('근무시간 외'); expect(html).toContain('대량'); expect(html).toContain('몰아보기');
    expect(html).toContain('href="/admin/settings/access-log?from=2026-10-18&amp;to=2026-11-18&amp;flag=any"');
    expect(html).toContain(`href="/admin/settings/access-log?from=2026-10-18&amp;to=2026-11-18&amp;subject=${ORDER}"`);
    expect(html).toContain(`href="/admin/settings/access-log?from=2026-10-18&amp;to=2026-11-18&amp;actor=${ACTOR}"`);
    expect(html).not.toContain(`href="/admin/sales/orders/${ORDER}"`);
    expect(html).toContain('평일 08~21시(KST) 밖이나 주말');
  });
  it('내려받기는 같은 조건의 POST 주소를 쓰고, 기록이 없거나 1만 건을 넘으면 막는다', () => {
    expect(render()).toContain('data-export-href="/api/admin/pii-access-log/export?from=2026-10-18&amp;to=2026-11-18"');
    const empty = renderToStaticMarkup(<PiiAccessLogScreen data={{ ...data, total: 0, items: [], summary: { total: 0, offHours: 0, bulk: 0, burst: 0, flagged: 0 } }} filters={normalizePiiAccessLogFilters({}, NOW)} />);
    expect(empty).toContain('이 조건의 접속기록이 없습니다.');
    const many = renderToStaticMarkup(<PiiAccessLogScreen data={{ ...data, total: 10_001 }} filters={normalizePiiAccessLogFilters({}, NOW)} />);
    expect(many).toContain('기간이나 조건을 좁혀주세요');
  });
  it('주소 조건을 바로잡았으면 알린다', () => {
    expect(render(normalizePiiAccessLogFilters({ actor: 'bad' }, NOW))).toContain('조회 조건 일부를 기본값으로 바꿔 조회했습니다');
  });
});
