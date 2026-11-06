import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { adminClaimHref, normalizeAdminClaimFilters, type AdminClaimConsoleData, type AdminClaimFilters } from '@/lib/admin/claims';
import { KitDatePresets } from '@/components/admin/kit/date-presets';
import { ClaimQueueKitScreen } from './ClaimQueueKitScreen';
import { claimKitFilterOptions, claimKitFiltersFor, claimKitStateFor } from './ClaimQueueKitTable';

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

describe('ClaimQueueKitScreen (admin kit)', () => {
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

  it('스마트스토어식 기간 프리셋(오늘·1주·1개월·3개월)을 기간 기준 옆에 둔다', () => {
    const html = renderToStaticMarkup(<ClaimQueueKitScreen data={data()} now={NOW} />);
    const group = html.match(/<div[^>]*aria-label="조회기간 빠른 선택"[^>]*>[\s\S]*?<\/div>/)?.[0] ?? '';
    expect(group).not.toBe('');
    expect([...group.matchAll(/<button[^>]*>([^<]+)<\/button>/g)].map((match) => match[1])).toEqual(['오늘', '1주', '1개월', '3개월']);
    expect(html.indexOf('aria-label="기간 기준"')).toBeLessThan(html.indexOf('aria-label="조회기간 빠른 선택"'));
  });

  it('표 도구 막대의 열 설정은 순서·틀고정까지 다루는 조회항목 설정이다(DESIGN.md §어드민 콘솔)', () => {
    const html = renderToStaticMarkup(<ClaimQueueKitScreen data={data()} now={NOW} />);
    expect(html).toContain('조회항목 설정');
    expect(html).not.toContain('표시할 열 선택');
    const trigger = html.match(/<button[^>]*>(?:(?!<\/button>)[\s\S])*조회항목 설정<\/button>/)?.[0] ?? '';
    expect(trigger).not.toBe('');
    expect(trigger).not.toMatch(/class="[^"]*\bhidden\b/);
  });

  it('고른 기간은 운영팀 표기(숫자 날짜 ~ 숫자 날짜)로 보이고 영어 날짜를 남기지 않는다', () => {
    const html = renderToStaticMarkup(<ClaimQueueKitScreen data={data({ filters: { ...FILTERS, from: '2026-10-30', to: '2026-11-05' } })} now={NOW} />);
    expect(html).toContain('2026. 10. 30. ~ 2026. 11. 05.');
    expect(html).not.toMatch(/October|November/);
  });
});

describe('KitDatePresets', () => {
  it('지금 조건과 같은 KST 기간의 프리셋만 눌린 상태다', () => {
    /* NOW = 2026-11-05 15:00 KST. 1주 = 오늘 포함 7일. */
    const html = renderToStaticMarkup(<KitDatePresets from="2026-10-30" now={NOW} onSelect={() => undefined} to="2026-11-05" />);
    const pressed = [...html.matchAll(/<button[^>]*aria-pressed="true"[^>]*>([^<]+)<\/button>/g)].map((match) => match[1]);
    expect(pressed).toEqual(['1주']);
  });

  it('기간이 없으면 아무 프리셋도 눌려 있지 않다', () => {
    const html = renderToStaticMarkup(<KitDatePresets from={null} now={NOW} onSelect={() => undefined} to={null} />);
    expect(html).not.toContain('aria-pressed="true"');
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

  it('KST보다 동쪽 시간대 브라우저에서도 고른 달력 날짜 그대로 URL에 남는다', () => {
    const original = process.env.TZ;
    process.env.TZ = 'Pacific/Kiritimati'; /* UTC+14 — 그 자정은 KST로 전날 19시다. */
    try {
      const filters = normalizeAdminClaimFilters({ stage: 'all', from: '2026-11-01', to: '2026-11-05' }, 'cancel');
      const state = claimKitStateFor(filters, 20);
      const next = claimKitFiltersFor(filters, state);
      expect([next.from, next.to]).toEqual(['2026-11-01', '2026-11-05']);
      const picked = claimKitFiltersFor(FILTERS, { columnFilters: [{ id: 'requested', value: [new Date(2026, 10, 3).getTime(), new Date(2026, 10, 4).getTime()] }], pagination: { pageIndex: 0, pageSize: 20 }, sorting: [] });
      expect([picked.from, picked.to]).toEqual(['2026-11-03', '2026-11-04']);
    } finally {
      if (original === undefined) delete process.env.TZ; else process.env.TZ = original;
    }
  });
});

/*
 * 반품·교환 목록도 같은 kit 화면이다(ADR-0028). 아래는 옮기기 전 반품·교환 목록(ClaimQueueScreen)이
 * 지키던 계약을 같은 의미로 kit 화면에서 확인한다.
 */
const RETURN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const RETURN_NOW = new Date('2026-08-20T06:00:00.000Z');

function returns(overrides: Partial<AdminClaimConsoleData> = {}): AdminClaimConsoleData {
  return {
    claimType: 'return',
    counts: { requested: 2, in_review: 0, collecting: 1, collected: 0, on_hold: 1, processing: 0, needs_review: 0, completed: 0, rejected: 0, withdrawn: 0 },
    filters: FILTERS,
    pageSize: 20,
    total: 2,
    rows: [
      {
        id: RETURN_ID, reference: 12, orderId: '11111111-1111-4111-8111-111111111111', claimType: 'return', stage: 'processing',
        reasonType: 'change_of_mind', staffReasonCode: null, buyerName: 'maple_fan', buyerEmail: 'buyer@example.com', orderStatus: 'delivered',
        orderTotal: 43000, requestedAt: '2026-08-18T01:00:00.000Z',
        /* 입고 확인 + 3영업일이 이미 지났다 — 목록에서 가장 먼저 보여야 할 행이다. */
        collectedAt: '2026-08-01T01:00:00.000Z', completedAt: null, refundMethod: 'pg_cancel', handlerName: 'cs_lead',
      },
      {
        id: DONE_ID, reference: 11, orderId: '22222222-2222-4222-8222-222222222222', claimType: 'return', stage: 'collecting',
        reasonType: 'defect', staffReasonCode: null, buyerName: 'second_fan', buyerEmail: null, orderStatus: 'delivered',
        orderTotal: 21000, requestedAt: '2026-08-19T01:00:00.000Z', collectedAt: null, completedAt: null, refundMethod: null, handlerName: null,
      },
    ],
    ...overrides,
  };
}

/** kit Select 트리거(aria-label)가 지금 보여 주는 값. Base UI Select는 선택값을 select-value 칸에 그린다. */
function selectValue(html: string, label: string) {
  const at = html.indexOf(`aria-label="${label}"`);
  return at < 0 ? null : html.slice(at).match(/data-slot="select-value"[^>]*>(?:<span>)?([^<]*)</)?.[1] ?? null;
}

describe('ClaimQueueKitScreen — 반품·교환 목록', () => {
  it.each([['recipient', '수취인명'], ['item', '상품주문번호'], ['product', '상품번호']] as const)('%s 상세조건과 전체 주문 처리 경계를 표시한다', (field, label) => {
    const source = returns(); source.filters = { ...source.filters, field, query: '번호_%', page: 2 };
    const html = renderToStaticMarkup(<ClaimQueueKitScreen data={source} now={RETURN_NOW} />);
    expect(selectValue(html, '검색 항목')).toBe(label);
    expect(html).toContain(`field=${field}`);
    /* 상세 팝업 링크도 같은 조건의 목록 위에서 열린다. */
    expect(html).toMatch(new RegExp(`href="[^"]*field=${field}[^"]*claimId=${RETURN_ID}"`));
    expect(html).toContain('품목으로 찾아도 처리와 엑셀은 요청 주문 전체를 대상으로 합니다.');
    expect(html).toContain('screen=claims-returns');
  });

  it('결제일 기간 검색을 목록·단계 링크·엑셀 주소에 함께 보존한다', () => {
    const source = returns(); source.filters = { ...source.filters, dateField: 'paid', from: '2026-10-02', to: '2026-10-02' };
    const html = renderToStaticMarkup(<ClaimQueueKitScreen data={source} now={RETURN_NOW} />);
    expect(selectValue(html, '기간 기준')).toBe('결제일');
    expect(html).toContain('dateField=paid');
    expect(html).toMatch(/aria-label="반품보류 1건"[^>]*href="[^"]*dateField=paid/);
    expect(html).toMatch(new RegExp(`href="[^"]*dateField=paid[^"]*claimId=${RETURN_ID}"`));
    expect(html).toContain('screen=claims-returns');
  });

  it('이슈가 요구한 그리드 컬럼을 순서대로 보여준다', () => {
    const html = renderToStaticMarkup(<ClaimQueueKitScreen data={returns()} now={RETURN_NOW} />);
    const header = html.slice(html.indexOf('<thead'), html.indexOf('</thead>'));
    const order = ['요청번호', '주문번호', '유형', '사유', '상태', '구매자', '주문금액', '접수일', '환급 기한', '환불 수단', '처리자'].map((column) => header.indexOf(`>${column}<`));
    expect(order.every((at) => at > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).toContain('C00012');
    expect(html).toContain('@maple_fan');
    expect(html).toContain('₩43,000');
    expect(html).toContain('단순 변심');
    expect(html).toContain('상품 하자·오배송');
  });

  /* 2026-10-12 QA-4: 운영자 전액 취소는 단순 변심이 아니라 운영 사유로 적고 거른다. */
  it('운영자 전액 취소 행은 운영 사유를 적고 사유 필터에서 고를 수 있다', () => {
    const base = returns();
    const html = renderToStaticMarkup(<ClaimQueueKitScreen data={data({
      rows: [{ ...base.rows[0], claimType: 'cancel', stage: 'needs_review', reasonType: 'staff', staffReasonCode: 'test_payment_cleanup' }],
      total: 1,
    })} now={RETURN_NOW} />);
    expect(html).toContain('운영자 전액 취소 · 테스트 결제 정리');
    expect(html).not.toContain('>단순 변심<');
    const reasons = claimKitFilterOptions('cancel').reason;
    expect(reasons).toContainEqual({ value: 'staff:out_of_stock', label: '운영자 전액 취소 · 품절·출고 불가' });
    expect(reasons).toContainEqual({ value: 'staff', label: '운영자 전액 취소 전체' });
  });

  /* R7: 취소에는 하자·오배송 사유를, 반품·교환에는 운영자 전액 취소를 고르지 않는다. 취소에는 수거 단계가 없다. */
  it('유형에 생길 수 없는 사유·단계는 필터 선택지에 없다', () => {
    const cancel = claimKitFilterOptions('cancel');
    expect(cancel.reason.map((option) => option.value)).not.toContain('defect');
    expect(cancel.reason).toContainEqual({ value: 'change_of_mind', label: '단순 변심' });
    expect(cancel.stage.map((option) => option.value)).not.toContain('collecting');
    for (const claimType of ['return', 'exchange'] as const) {
      const options = claimKitFilterOptions(claimType);
      expect(options.reason).toContainEqual({ value: 'defect', label: '상품 하자·오배송' });
      expect(options.reason.map((option) => option.label)).not.toContain('운영자 전액 취소 전체');
      expect(options.stage.map((option) => option.value)).toEqual(expect.arrayContaining(['open', 'collecting', 'collected']));
    }
    /* 표 도구 막대의 필터 이름도 유형을 따른다. */
    const html = renderToStaticMarkup(<ClaimQueueKitScreen data={returns()} now={RETURN_NOW} />);
    expect(html).toContain('반품사유');
    expect(html).toContain('반품처리상태');
    expect(html).not.toContain('취소처리상태');
  });

  /* SLA는 목록에서 가장 먼저 보는 값이다. 색만이 아니라 톤 속성으로 강조가 남아야 한다. */
  it('환급 기한을 넘긴 행을 danger 톤으로 표시하고, 입고 전 요청에는 기한을 지어내지 않는다', () => {
    const html = renderToStaticMarkup(<ClaimQueueKitScreen data={returns()} now={RETURN_NOW} />);
    expect(html).toMatch(/<span[^>]* data-sla-tone="danger">기한 초과<\/span>/);
    expect(html).toMatch(/<span[^>]* data-sla-tone="[a-z]+">입고 전<\/span>/);
  });

  /* 결제수단은 private.payment_provider_evidence에만 있고 staff 표면이 없다(#250).
     환불 수단은 refunds.method라 정직하게 말할 수 있는 값이다. */
  it('환불 수단은 원장에 적힌 값만 말한다', () => {
    const html = renderToStaticMarkup(<ClaimQueueKitScreen data={returns()} now={RETURN_NOW} />);
    expect(html).toContain('>결제사 취소<');
    expect(html).toContain('미접수');
  });

  /* 0건 칩을 감추면 "정말 0건"과 "집계 실패"를 구분할 수 없다. 반품·교환에는 수거 단계 칩이 있다. */
  it('0건 단계도 칩으로 남기고 수거 단계를 함께 센다', () => {
    const html = renderToStaticMarkup(<ClaimQueueKitScreen data={returns()} now={RETURN_NOW} />);
    for (const chip of ['반품요청 2건', '반품 검토중 0건', '수거중 1건', '수거완료 0건', '반품보류 1건', '처리중 0건', '결제확인필요 0건', '반품완료 0건', '반품거부 0건']) {
      expect(html).toContain(`aria-label="${chip}"`);
    }
    const cancel = renderToStaticMarkup(<ClaimQueueKitScreen data={data()} now={NOW} />);
    expect(cancel).not.toContain('aria-label="수거중');
  });

  /* R8: 요청번호는 독립 상세 라우트가 아니라 같은 목록 위의 팝업(?claimId=)으로 연다. */
  it('요청번호가 목록 조건을 유지한 채 상세 팝업을 연다', () => {
    const html = renderToStaticMarkup(<ClaimQueueKitScreen data={returns()} now={RETURN_NOW} />);
    expect(html).toContain(`href="/admin/sales/claims/returns?stage=open&amp;page=1&amp;claimId=${RETURN_ID}"`);
    expect(html).not.toContain(`/admin/sales/claims/returns/${RETURN_ID}?back=`);
    expect(html).toContain('여는 중');
  });

  /* R8 · D8: 선택 → 건별 순차 처리 → 결과표. 처리 단계가 끝난 건은 고를 수 없다(처리 막대는 kit ActionBar라 선택 뒤에만 뜬다). */
  it('처리할 수 있는 단계의 행만 고르고, 처리할 수 없는 행의 선택 칸은 잠긴다', () => {
    const html = renderToStaticMarkup(<ClaimQueueKitScreen data={returns()} now={RETURN_NOW} />);
    const checkbox = (label: string) => html.match(new RegExp(`<span[^>]*aria-label="${label}"[^>]*>`))?.[0] ?? '';
    expect(checkbox('요청 C00011 선택')).not.toBe('');
    expect(checkbox('요청 C00011 선택')).not.toContain('aria-disabled="true"');
    expect(checkbox('요청 C00012 선택')).toContain('aria-disabled="true"');
    expect(html).toContain('aria-label="이 페이지에서 처리할 수 있는 요청 모두 선택"');
    expect(html).toContain('승인·검토중·거부를 한 번에 처리합니다(최대 50건)');
  });

  it('반품·교환 메뉴설명은 배송비 정책·대기 목록과 상세에서 한 건씩 하는 처리를 안내한다', () => {
    const html = renderToStaticMarkup(<ClaimQueueKitScreen canViewRefundTransfers data={returns()} now={RETURN_NOW} />);
    expect(html).toContain('href="/admin/sales/claims/returns/fee-policy"');
    expect(html).toContain('href="/admin/sales/claims/returns/fees"');
    expect(html).toContain('회수 확인·재출고·환불 확정과 반품·교환 전환은 상세에서 한 건씩 처리합니다.');
    expect(html).toContain('환불 송금 대기');
    /* 교환에는 환불이 없어 송금 대기 안내를 하지 않는다. 취소에는 배송비 청구가 없다. */
    const exchange = renderToStaticMarkup(<ClaimQueueKitScreen canViewRefundTransfers data={returns({ claimType: 'exchange', rows: [], total: 0 })} now={RETURN_NOW} />);
    expect(exchange).not.toContain('환불 송금 대기');
    const cancel = renderToStaticMarkup(<ClaimQueueKitScreen canViewRefundTransfers data={data()} now={NOW} />);
    expect(cancel).not.toContain('fee-policy');
    expect(cancel).toContain('환불 송금 대기');
  });

  /* 부분 환불은 계획의 명시적 제외 항목이다. 화면이 약속하는 순간 운영이 따라간다. */
  it('부분 환불을 약속하지 않고 환급 기한의 기산점을 밝힌다', () => {
    const html = renderToStaticMarkup(<ClaimQueueKitScreen data={returns()} now={RETURN_NOW} />);
    expect(html).toContain('주문 단위 전액');
    expect(html).toContain('일부만 환급하는 처리는 제공하지 않습니다');
    expect(html).toContain('약관 제16조');
  });

  it('행이 없으면 조건에 맞는 요청이 없다고 알린다', () => {
    const html = renderToStaticMarkup(<ClaimQueueKitScreen data={returns({ rows: [], total: 0 })} now={RETURN_NOW} />);
    expect(html).toContain('조건에 맞는 반품 요청이 없습니다.');
  });

  it('교환 화면은 교환 경로로 링크한다', () => {
    const html = renderToStaticMarkup(<ClaimQueueKitScreen data={returns({ claimType: 'exchange', rows: [], total: 0 })} now={RETURN_NOW} />);
    expect(html).toContain('/admin/sales/claims/exchanges');
    expect(html).toContain('조건에 맞는 교환 요청이 없습니다.');
    expect(html).toContain('aria-label="교환 요청 목록"');
    expect(html).toContain('aria-label="교환 요청 검색"');
    /* 검색은 양식 제출이다(kit 버튼은 type을 주지 않으면 button이다). */
    expect(html).toMatch(/<form[^>]*aria-label="교환 요청 검색"[^>]*>(?:(?!<\/form>)[\s\S])*<button[^>]*type="submit"[^>]*>검색<\/button>/);
  });
});

describe('취소·반품·교환 목록 엑셀 다운로드', () => {
  it('유형별 화면 id와 현재 조건으로 내려받는다', () => {
    const html = renderToStaticMarkup(<ClaimQueueKitScreen data={returns({ filters: { from: '2026-10-01', page: 2, query: 'C00042', reasonType: 'defect', stage: 'all', to: null } })} now={RETURN_NOW} />);
    expect(html).toContain('목록 엑셀 다운로드');
    expect(html).toContain('data-export-href="/api/admin/list-export?screen=claims-returns&amp;stage=all&amp;reasonType=defect&amp;from=2026-10-01&amp;query=C00042"');
  });
});
