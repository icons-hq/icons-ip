import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { adminClaimHref, normalizeAdminClaimFilters, type AdminClaimConsoleData, type AdminClaimFilters } from '@/lib/admin/claims';
import { ClaimQueueKitScreen } from './ClaimQueueKitScreen';
import { claimKitFiltersFor, claimKitStateFor } from './ClaimQueueKitTable';

/* kit 표는 useRouter로 이동한다. 기존 목록 테스트는 라우터 없이 렌더됐지만 이 화면은 목이 필요하다. */
vi.mock('next/navigation', () => ({
  unstable_rethrow: () => undefined,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const NOW = new Date('2026-11-05T06:00:00.000Z');
const CLAIM_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const DONE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const FILTERS: AdminClaimFilters = { from: null, page: 1, query: '', reasonType: 'all', stage: 'open', to: null };

function data(overrides: Partial<AdminClaimConsoleData> = {}): AdminClaimConsoleData {
  return {
    claimType: 'cancel',
    counts: { requested: 1, in_review: 0, collecting: 0, collected: 0, on_hold: 0, processing: 0, needs_review: 0, completed: 1, rejected: 0, withdrawn: 0 },
    filters: FILTERS,
    pageSize: 20,
    total: 2,
    rows: [
      {
        id: CLAIM_ID, reference: 31, orderId: '11111111-1111-4111-8111-111111111111', claimType: 'cancel', stage: 'requested',
        reasonType: 'change_of_mind', staffReasonCode: null, buyerName: 'maple_fan', buyerEmail: null, orderStatus: 'paid',
        orderTotal: 43000, requestedAt: '2026-11-04T01:00:00.000Z', collectedAt: null, completedAt: null, refundMethod: null, handlerName: null,
      },
      {
        id: DONE_ID, reference: 30, orderId: '22222222-2222-4222-8222-222222222222', claimType: 'cancel', stage: 'completed',
        reasonType: 'change_of_mind', staffReasonCode: null, buyerName: 'done_fan', buyerEmail: null, orderStatus: 'cancelled',
        orderTotal: 12000, requestedAt: '2026-11-01T01:00:00.000Z', collectedAt: null, completedAt: '2026-11-01T02:00:00.000Z', refundMethod: 'pg_cancel', handlerName: 'cs_lead',
      },
    ],
    ...overrides,
  };
}

describe('ClaimQueueKitScreen (admin kit PoC)', () => {
  it('서버 렌더에서 운영팀 어휘로 그리고 영어 부품 문구를 남기지 않는다', () => {
    const html = renderToStaticMarkup(<ClaimQueueKitScreen data={data()} now={NOW} />);
    expect(html).toContain('요청번호');
    expect(html).toContain('취소처리상태');
    expect(html).toContain('취소사유');
    expect(html).toContain('페이지당 행');
    expect(html).toContain('1 / 1 페이지');
    expect(html).toContain('0건 선택');
    for (const english of ['No results', 'Rows per page', 'Page 1 of', 'rows selected', 'Reset', 'View', 'Go to']) {
      expect(html).not.toContain(english);
    }
  });

  it('요청번호는 같은 목록 위 상세 팝업 링크다', () => {
    const html = renderToStaticMarkup(<ClaimQueueKitScreen data={data()} now={NOW} />);
    expect(html).toContain(`claimId=${CLAIM_ID}`);
    expect(html).toContain('aria-label="요청 C00031 상세 열기"');
  });

  it('처리할 수 없는 행(완료)은 선택 칸이 잠긴다', () => {
    const html = renderToStaticMarkup(<ClaimQueueKitScreen data={data()} now={NOW} />);
    /* Base UI 체크박스는 <span role="checkbox">다. 속성 순서는 라이브러리 몫이라 태그 단위로 본다. */
    const checkbox = (label: string) => html.match(new RegExp(`<span[^>]*aria-label="${label}"[^>]*>`))?.[0] ?? '';
    expect(checkbox('요청 C00031 선택')).not.toContain('aria-disabled="true"');
    expect(checkbox('요청 C00030 선택')).toContain('aria-disabled="true"');
  });

  it('빈 목록 문구를 표 안에 보인다', () => {
    const html = renderToStaticMarkup(<ClaimQueueKitScreen data={data({ rows: [], total: 0 })} now={NOW} />);
    expect(html).toContain('조건에 맞는 취소 요청이 없습니다.');
  });
});

describe('kit 표 상태 ↔ 기존 URL 계약', () => {
  it('서버 필터를 표 상태로 옮겼다가 되돌리면 같은 href다', () => {
    const filters = normalizeAdminClaimFilters({ stage: 'requested', reasonType: 'staff', from: '2026-11-01', to: '2026-11-05', page: '3', pageSize: '50', sort: 'amount_high', query: '홍길동', field: 'buyer' }, 'cancel');
    const state = claimKitStateFor(filters, 50);
    expect(adminClaimHref('cancel', claimKitFiltersFor(filters, state))).toBe(adminClaimHref('cancel', filters));
  });

  it('필터를 지우면 전체, 정렬 기본값은 URL에서 빠진다', () => {
    const filters = normalizeAdminClaimFilters({ stage: 'requested', sort: 'oldest' }, 'cancel');
    const state = claimKitStateFor(filters, 20);
    const next = claimKitFiltersFor(filters, { ...state, columnFilters: [], sorting: [{ id: 'requested', desc: true }] });
    expect(adminClaimHref('cancel', next)).toBe('/admin/sales/claims/cancels?stage=all&page=1');
  });

  it('달력 날짜는 KST 달력 날짜로 남고, 뒤집힌 기간은 바로잡는다', () => {
    const later = new Date(2026, 10, 5).getTime();
    const earlier = new Date(2026, 10, 1).getTime();
    const next = claimKitFiltersFor(FILTERS, { columnFilters: [{ id: 'requested', value: [later, earlier] }], pagination: { pageIndex: 0, pageSize: 20 }, sorting: [] });
    expect(next.from).toBe('2026-11-01');
    expect(next.to).toBe('2026-11-05');
  });
});
