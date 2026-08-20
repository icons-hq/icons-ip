import { describe, expect, it } from 'vitest';
import {
  adminClaimBackHref,
  adminClaimBasePath,
  adminClaimBuyerLabel,
  adminClaimDetailHref,
  adminClaimHref,
  adminClaimOpenCount,
  normalizeAdminClaimCollectionForm,
  normalizeAdminClaimDecisionForm,
  normalizeAdminClaimFilters,
  normalizeAdminClaimRefundForm,
  normalizeAdminClaimReshipmentForm,
  type AdminClaimFilters,
} from './claims';

const CLAIM_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function filters(overrides: Partial<AdminClaimFilters> = {}): AdminClaimFilters {
  return {
    from: null,
    page: 1,
    query: '',
    reasonType: 'all',
    stage: 'open',
    to: null,
    ...overrides,
  };
}

function formData(entries: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

describe('클레임 콘솔 경로', () => {
  /* 사이드바 href와 글자 그대로 같아야 requireAdminScreenAccess가 화면을 찾는다. */
  it('사이드바가 가리키는 세 경로를 만든다', () => {
    expect(adminClaimBasePath('cancel')).toBe('/admin/sales/claims/cancels');
    expect(adminClaimBasePath('return')).toBe('/admin/sales/claims/returns');
    expect(adminClaimBasePath('exchange')).toBe('/admin/sales/claims/exchanges');
  });

  it('상세 링크가 목록 조건을 함께 들고 간다', () => {
    const href = adminClaimDetailHref('return', CLAIM_ID, filters({ page: 3, stage: 'collecting' }));
    expect(href).toContain(`/admin/sales/claims/returns/${CLAIM_ID}?back=`);
    expect(decodeURIComponent(href.split('back=')[1])).toContain('stage=collecting');
  });

  /* back은 URL에서 온 값이다. 모르는 파라미터를 실어 나르면 목록 URL이 임의 입력의
     운반 수단이 된다. */
  it('back에 실린 모르는 파라미터를 버린다', () => {
    const href = adminClaimBackHref('return', 'stage=collecting&evil=%3Cscript%3E&page=2');
    expect(href).toBe('/admin/sales/claims/returns?stage=collecting&page=2');
  });

  it('back이 비면 목록 기본값으로 돌아간다', () => {
    expect(adminClaimBackHref('cancel', undefined)).toBe('/admin/sales/claims/cancels');
  });
});

describe('클레임 필터 정규화', () => {
  it('기본 필터는 미처리다', () => {
    expect(normalizeAdminClaimFilters({}).stage).toBe('open');
  });

  it('모르는 값은 기본값으로 접는다', () => {
    const normalized = normalizeAdminClaimFilters({
      page: '-3',
      reasonType: 'whatever',
      stage: 'nope',
    });
    expect(normalized).toMatchObject({ stage: 'open', reasonType: 'all', page: 1 });
  });

  /* 뒤집힌 기간은 RPC가 거절한다. 화면이 오류로 죽는 대신 조건을 버린다. */
  it('뒤집힌 기간을 버린다', () => {
    expect(normalizeAdminClaimFilters({ from: '2026-08-20', to: '2026-08-01' }))
      .toMatchObject({ from: null, to: null });
  });

  it('달력에 없는 날짜를 거른다', () => {
    expect(normalizeAdminClaimFilters({ from: '2026-02-30' }).from).toBeNull();
  });

  it('필터가 URL에 남는다', () => {
    expect(adminClaimHref('cancel', filters({ reasonType: 'defect', query: 'A1B2' })))
      .toBe('/admin/sales/claims/cancels?stage=open&reasonType=defect&query=A1B2&page=1');
  });
});

describe('구매자 표기와 집계', () => {
  /* seed는 구매자 id다 — 주문 콘솔의 fan_ 축약과 같은 구매자에 같은 이름이 나와야 한다. */
  it('닉네임이 비면 구매자 id 축약을 쓴다', () => {
    expect(adminClaimBuyerLabel(null, 'ab12cd34-5678-4abc-8def-111111111111'))
      .toBe('fan_ab12cd');
    expect(adminClaimBuyerLabel(' maple ', 'ab12cd34-5678-4abc-8def-111111111111'))
      .toBe('maple');
  });

  /* `open` 칩과 `open` 필터가 같은 집합을 가리켜야 숫자와 목록이 어긋나지 않는다. */
  it('미처리 합계에 종료 단계를 넣지 않는다', () => {
    expect(adminClaimOpenCount({
      requested: 1,
      in_review: 2,
      collecting: 3,
      collected: 4,
      on_hold: 5,
      processing: 6,
      needs_review: 7,
      completed: 100,
      rejected: 200,
    })).toBe(28);
  });
});

describe('콘솔 폼 정규화', () => {
  it('거부와 보류는 10자 이상 사유를 요구한다', () => {
    expect(normalizeAdminClaimDecisionForm(
      formData({ claimId: CLAIM_ID, decision: 'reject', note: '짧음' }),
    )).toMatchObject({ ok: false });
    expect(normalizeAdminClaimDecisionForm(
      formData({ claimId: CLAIM_ID, decision: 'hold', note: '반품 배송비 정산이 확인되지 않았습니다' }),
    )).toMatchObject({ ok: true });
  });

  it('승인에는 사유가 필요 없다', () => {
    expect(normalizeAdminClaimDecisionForm(
      formData({ claimId: CLAIM_ID, decision: 'approve' }),
    )).toEqual({ ok: true, value: { claimId: CLAIM_ID, decision: 'approve', note: null } });
  });

  it('모르는 결정을 거절한다', () => {
    expect(normalizeAdminClaimDecisionForm(
      formData({ claimId: CLAIM_ID, decision: 'complete' }),
    )).toMatchObject({ ok: false });
  });

  it('환불 수단은 두 값만 받는다', () => {
    expect(normalizeAdminClaimRefundForm(
      formData({ claimId: CLAIM_ID, method: 'cash', stage: 'filed' }),
    )).toMatchObject({ ok: false });
    expect(normalizeAdminClaimRefundForm(
      formData({ claimId: CLAIM_ID, method: 'bank_transfer', stage: 'completed' }),
    )).toMatchObject({ ok: true, value: { method: 'bank_transfer', stage: 'completed' } });
  });

  /* 운송장 형식은 orders.tracking_number CHECK와 같다. 갈라지면 링크가 깨진다. */
  it('재출고 운송장 형식을 DB와 맞춘다', () => {
    expect(normalizeAdminClaimReshipmentForm(
      formData({ carrier: 'hanjin', claimId: CLAIM_ID, trackingNumber: 'ab-12' }),
    )).toMatchObject({ ok: false });
    expect(normalizeAdminClaimReshipmentForm(
      formData({ carrier: 'hanjin', claimId: CLAIM_ID, trackingNumber: 'ld00000000c04' }),
    )).toEqual({
      ok: true,
      value: { claimId: CLAIM_ID, carrier: 'hanjin', trackingNumber: 'LD00000000C04' },
    });
  });

  it('수거 단계는 두 값만 받는다', () => {
    expect(normalizeAdminClaimCollectionForm(
      formData({ claimId: CLAIM_ID, stage: 'processing' }),
    )).toMatchObject({ ok: false });
    expect(normalizeAdminClaimCollectionForm(
      formData({ claimId: CLAIM_ID, stage: 'collected' }),
    )).toMatchObject({ ok: true, value: { stage: 'collected' } });
  });

  it('클레임 id가 uuid가 아니면 거절한다', () => {
    expect(normalizeAdminClaimDecisionForm(
      formData({ claimId: 'not-a-uuid', decision: 'approve' }),
    )).toMatchObject({ ok: false });
  });
});
