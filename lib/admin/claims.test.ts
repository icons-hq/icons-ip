import { describe, expect, it } from 'vitest';
import { orderClaimReferenceLabel } from '@/lib/orders/claims';
import {
  adminClaimBackHref,
  adminClaimBasePath,
  adminClaimBuyerLabel,
  adminClaimDetailHref,
  adminClaimHref,
  adminClaimOpenCount,
  adminClaimPreviewHref,
  adminClaimPreviewId,
  adminClaimReasonOptions,
  adminClaimReasonText,
  adminClaimReceivedOnLabel,
  adminClaimRejectionPresets,
  adminClaimSearchQuery,
  adminClaimStageLabel,
  adminClaimTodayKst,
  ADMIN_CLAIM_DATE_FIELDS,
  ADMIN_CLAIM_REASON_OPTIONS,
  ADMIN_CLAIM_REJECTION_PRESETS,
  ADMIN_CLAIM_SEARCH_FIELDS,
  normalizeAdminClaimCollectionForm,
  normalizeAdminClaimOriginCollectionForm,
  normalizeAdminClaimOperationalFeeForm,
  normalizeAdminClaimDecisionForm,
  normalizeAdminClaimFilters,
  normalizeAdminClaimReceivedOn,
  normalizeAdminClaimRefundForm,
  type AdminClaimFilters,
} from './claims';

const CLAIM_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

describe('출고지별 회수 확인 입력', () => {
  const shipmentId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  it('정확한 클레임·배송 건과 회수 확인 근거를 받는다', () => {
    expect(normalizeAdminClaimOriginCollectionForm(formData({ claimId: CLAIM_ID, shipmentId,
      evidence: '  창고 회신 R-001: 상품 2개 수량 대조 완료  ' }))).toEqual({ ok: true,
      value: { claimId: CLAIM_ID, shipmentId, bundleId: null, evidence: '창고 회신 R-001: 상품 2개 수량 대조 완료', receivedOn: null } });
  });
  /* S36-040: 반품지가 갈린 배송 건은 회수 묶음을 골라 확인한다. 형식 밖 묶음 키는 받지 않는다. */
  it('회수 묶음 키는 선택이고 UUID만 받는다', () => {
    const bundleId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    expect(normalizeAdminClaimOriginCollectionForm(formData({ claimId: CLAIM_ID, shipmentId, bundleId: bundleId.toUpperCase(), evidence: '서울 반품지 입고' })))
      .toMatchObject({ ok: true, value: { shipmentId, bundleId } });
    expect(normalizeAdminClaimOriginCollectionForm(formData({ claimId: CLAIM_ID, shipmentId, bundleId: 'seoul', evidence: '서울 반품지 입고' })))
      .toEqual({ ok: false, error: '회수 확인할 반품지를 다시 선택해주세요.' });
  });
  /* 1027T-033: 실제 입고일은 KST 달력 날짜이고, 비우면 DB가 오늘로 적는다. 미래·형식 밖 날짜는 받지 않는다. */
  it('실제 입고일을 날짜로 받고 미래·형식 밖 값은 거절한다', () => {
    expect(normalizeAdminClaimOriginCollectionForm(formData({ claimId: CLAIM_ID, shipmentId, evidence: '입고 확인', receivedOn: '2026-01-02' })))
      .toMatchObject({ ok: true, value: { receivedOn: '2026-01-02' } });
    for (const receivedOn of ['2999-01-01', '2026-02-30', '2026/01/02', 'yesterday']) {
      expect(normalizeAdminClaimOriginCollectionForm(formData({ claimId: CLAIM_ID, shipmentId, evidence: '입고 확인', receivedOn })))
        .toEqual({ ok: false, error: '실제 입고일은 오늘이나 그 이전 날짜로 입력해주세요.' });
    }
  });
  it('KST 오늘은 UTC 날짜가 아니라 한국 날짜다', () => {
    expect(adminClaimTodayKst(new Date('2026-11-11T15:30:00.000Z'))).toBe('2026-11-12');
    expect(normalizeAdminClaimReceivedOn('2026-11-12', new Date('2026-11-11T15:30:00.000Z'))).toEqual({ ok: true, value: '2026-11-12' });
    expect(normalizeAdminClaimReceivedOn('2026-11-13', new Date('2026-11-11T15:30:00.000Z')).ok).toBe(false);
    expect(normalizeAdminClaimReceivedOn('', new Date())).toEqual({ ok: true, value: null });
  });
  it.each(['', '  ', '가'.repeat(501)])('확인 근거가 비었거나 너무 길면 거절한다', (evidence) => {
    expect(normalizeAdminClaimOriginCollectionForm(formData({ claimId: CLAIM_ID, shipmentId, evidence })).ok).toBe(false);
  });
  it('배송 건 UUID가 없으면 다른 출고지를 추정하지 않는다', () => {
    expect(normalizeAdminClaimOriginCollectionForm(formData({ claimId: CLAIM_ID, evidence: '입고 확인' })).ok).toBe(false);
  });
  it('여러 줄로 적은 근거를 보존하고 표시할 수 없는 제어문자는 거절한다', () => {
    const evidence = '창고 회신 R-001\n상품 A\t2개 대조 완료';
    expect(normalizeAdminClaimOriginCollectionForm(formData({ claimId: CLAIM_ID, shipmentId, evidence })))
      .toEqual({ ok: true, value: { claimId: CLAIM_ID, shipmentId, bundleId: null, evidence, receivedOn: null } });
    expect(normalizeAdminClaimOriginCollectionForm(formData({ claimId: CLAIM_ID, shipmentId, evidence: `근거${String.fromCharCode(1)}` })).ok).toBe(false);
  });
});

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
  /* R8: 상세는 같은 목록 위 팝업으로 연다. 닫으면 claimId만 빠진 같은 조건의 목록이다. */
  it('목록 위 팝업 주소는 목록 조건 뒤에 claimId만 더한다', () => {
    const current = filters({ page: 3, stage: 'collecting' });
    expect(adminClaimPreviewHref('return', CLAIM_ID, current)).toBe(`${adminClaimHref('return', current)}&claimId=${CLAIM_ID}`);
    expect(adminClaimPreviewHref('exchange', CLAIM_ID)).toBe(`/admin/sales/claims/exchanges?claimId=${CLAIM_ID}`);
    expect(normalizeAdminClaimFilters({ stage: 'collecting', page: '3', claimId: CLAIM_ID })).toEqual(current);
  });

  it('팝업으로 열 claimId는 UUID 하나만 받는다', () => {
    expect(adminClaimPreviewId(CLAIM_ID.toUpperCase())).toBe(CLAIM_ID);
    expect(adminClaimPreviewId([CLAIM_ID, CLAIM_ID])).toBeNull();
    expect(adminClaimPreviewId('../evil')).toBeNull();
    expect(adminClaimPreviewId(undefined)).toBeNull();
  });
});

describe('클레임 필터 정규화', () => {
  it.each(['recipient', 'item'] as const)('새 상세조건 %s을 페이지·상세 복귀에도 보존한다', (field) => {
    const query = '전체%_번호-AB12';
    const result = normalizeAdminClaimFilters({ field, query: `  ${query}  `, dateField: 'paid', stage: 'all', page: '3' });
    expect(result).toMatchObject({ field, query, dateField: 'paid', page: 3 });
    const href = adminClaimHref('return', result);
    const back = adminClaimDetailHref('return', CLAIM_ID, result).split('?back=')[1];
    expect(adminClaimBackHref('return', decodeURIComponent(back))).toBe(href);
    expect(new URL(href, 'https://icons.test').searchParams.get('field')).toBe(field);
    expect(new URL(href, 'https://icons.test').searchParams.get('query')).toBe(query);
  });

  it('중복·알 수 없는 검색 대상은 전체로 처리하고 전체 기본값은 URL에 붙이지 않는다', () => {
    for (const field of [['recipient', 'item'], 'recipientName', 'goodId', 'all']) {
      expect(normalizeAdminClaimFilters({ field }).field).toBeUndefined();
    }
  });

  /* L-06: 상품 URL(고객 화면 주소 끝의 영문 값)은 검색 항목에서 뺐다. 전체 검색이 그 값도 찾으므로 옛 주소는 전체로 읽는다. */
  it('상품 URL은 검색 항목에 없고, 옛 주소의 field=product는 전체로 읽는다', () => {
    expect(ADMIN_CLAIM_SEARCH_FIELDS.map((option) => option.label)).toEqual(['전체', '주문·요청번호', '구매자', '구매자 이메일', '수령인명', '상품주문번호']);
    expect(normalizeAdminClaimFilters({ field: 'product', query: 'abc' })).toMatchObject({ query: 'abc' });
    expect(normalizeAdminClaimFilters({ field: 'product', query: 'abc' }).field).toBeUndefined();
  });

  /* L-01·L-03: 기간 기준 이름은 표의 열 이름과 같다(접수일·입고완료일). 단계 이름은 세 유형이 같은 틀이다. */
  it('기간 기준과 단계 이름은 표와 같은 말을 쓰고 세 유형이 같은 틀이다', () => {
    expect(ADMIN_CLAIM_DATE_FIELDS.map((option) => option.label)).toEqual(['접수일', '결제일', '입고완료일', '처리완료일']);
    for (const type of ['cancel', 'return', 'exchange'] as const) {
      const name = { cancel: '취소', return: '반품', exchange: '교환' }[type];
      expect(adminClaimStageLabel(type, 'requested')).toBe(`${name}요청`);
      expect(adminClaimStageLabel(type, 'in_review')).toBe(`${name}검토중`);
      expect(adminClaimStageLabel(type, 'on_hold')).toBe(`${name}보류`);
      expect(adminClaimStageLabel(type, 'completed')).toBe(`${name}완료`);
      expect(adminClaimStageLabel(type, 'rejected')).toBe(`${name}거부`);
      expect(adminClaimStageLabel(type, 'withdrawn')).toBe(`${name}철회`);
    }
    /* 창고에 돌아온 단계는 고객 화면·엑셀의 '입고완료'와 같은 말이다. */
    expect(adminClaimStageLabel('return', 'collected')).toBe('입고완료');
    expect(adminClaimStageLabel('exchange', 'collected')).toBe('입고완료');
    expect(adminClaimStageLabel('return', 'collecting')).toBe('수거중');
    expect(adminClaimStageLabel('cancel', 'processing')).toBe('처리중');
    expect(adminClaimStageLabel('cancel', 'needs_review')).toBe('결제확인필요');
  });

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

  /* 2026-10-12 QA-4: 운영자 전액 취소를 구매자 단순 변심과 따로, 운영 사유로 거른다. */
  it('운영자 전액 취소 전체와 운영 사유 하나로 거를 수 있다', () => {
    expect(normalizeAdminClaimFilters({ reasonType: 'staff' }).reasonType).toBe('staff');
    expect(normalizeAdminClaimFilters({ reasonType: 'staff:test_payment_cleanup' }).reasonType)
      .toBe('staff:test_payment_cleanup');
    expect(normalizeAdminClaimFilters({ reasonType: 'staff:refund_anyway' }).reasonType).toBe('all');
    expect(adminClaimHref('cancel', filters({ reasonType: 'staff:out_of_stock' })))
      .toBe('/admin/sales/claims/cancels?stage=open&reasonType=staff%3Aout_of_stock&page=1');
    expect(ADMIN_CLAIM_REASON_OPTIONS.map((option) => option.label)).toEqual([
      '전체',
      '단순 변심',
      '상품 하자·오배송',
      '운영자 전액 취소 전체',
      '운영자 전액 취소 · 품절·출고 불가',
      '운영자 전액 취소 · 고객 요청(CS 접수)',
      '운영자 전액 취소 · 테스트 결제 정리',
      '운영자 전액 취소 · 기타',
    ]);
  });
  /* R7: 하자·오배송은 받은 뒤의 일이다. 취소 화면은 단순 변심과 운영자 전액 취소만, 반품·교환은
     구매자 사유 둘만 거른다(운영자 전액 취소는 DB 제약상 취소 전용). 기존 행의 표기는 그대로다. */
  it('유형마다 그 유형에 생길 수 있는 사유만 필터로 보인다', () => {
    expect(adminClaimReasonOptions('cancel').map((option) => option.value)).toEqual([
      'all', 'change_of_mind', 'staff', 'staff:out_of_stock', 'staff:customer_request', 'staff:test_payment_cleanup', 'staff:other',
    ]);
    for (const type of ['return', 'exchange'] as const) {
      expect(adminClaimReasonOptions(type).map((option) => option.value)).toEqual(['all', 'change_of_mind', 'defect']);
    }
    expect(normalizeAdminClaimFilters({ reasonType: 'defect' }, 'cancel').reasonType).toBe('all');
    expect(normalizeAdminClaimFilters({ reasonType: 'staff:other' }, 'return').reasonType).toBe('all');
    expect(normalizeAdminClaimFilters({ reasonType: 'defect' }, 'exchange').reasonType).toBe('defect');
    expect(adminClaimBackHref('cancel', 'reasonType=defect&stage=all')).toBe('/admin/sales/claims/cancels?stage=all&page=1');
    expect(adminClaimReasonText('defect')).toBe('상품 하자·오배송');
  });
});

describe('거부 사유 프리셋', () => {
  it('확정 문구 네 개는 모두 10자 이상이고 앞뒤 공백이 없다(DB invalid rejection reason 규칙)', () => {
    expect(ADMIN_CLAIM_REJECTION_PRESETS).toEqual([
      '이미 발송되어 취소할 수 없습니다.',
      '회수한 상품에 사용 흔적이 있어 반품할 수 없습니다.',
      '교환할 옵션의 재고가 없어 교환할 수 없습니다.',
      '반품 가능 기간이 지났습니다.',
    ]);
    for (const preset of ADMIN_CLAIM_REJECTION_PRESETS) {
      expect(preset.trim()).toBe(preset);
      expect(preset.length).toBeGreaterThanOrEqual(10);
      expect(preset.length).toBeLessThanOrEqual(200);
    }
  });

  it('유형에 맞는 프리셋만 고를 수 있다', () => {
    expect(adminClaimRejectionPresets('cancel')).toEqual(['이미 발송되어 취소할 수 없습니다.']);
    expect(adminClaimRejectionPresets('return')).toEqual(['회수한 상품에 사용 흔적이 있어 반품할 수 없습니다.', '반품 가능 기간이 지났습니다.']);
    expect(adminClaimRejectionPresets('exchange')).toEqual(['교환할 옵션의 재고가 없어 교환할 수 없습니다.']);
  });
});

describe('클레임 사유 표기', () => {
  it('운영자 전액 취소는 단순 변심이 아니라 운영 사유로 적는다', () => {
    expect(adminClaimReasonText('staff', 'test_payment_cleanup')).toBe('운영자 전액 취소 · 테스트 결제 정리');
    expect(adminClaimReasonText('staff', null)).toBe('운영자 전액 취소');
    expect(adminClaimReasonText('change_of_mind')).toBe('단순 변심');
    expect(adminClaimReasonText('defect')).toBe('상품 하자·오배송');
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
      rejected: 200, withdrawn: 0,
    })).toBe(28);
  });
});

describe('콘솔 폼 정규화', () => {
  it('운영 확인액은 0원과 미확인을 구분하고 근거를 요구한다', () => {
    const base = { claimId: CLAIM_ID, expectedUpdatedAt: '2026-09-10T00:00:00Z', feeKind: 'return_shipping', note: '반품 배송비 확인', evidence: '택배 회신' };
    expect(normalizeAdminClaimOperationalFeeForm(formData({ ...base, amount: '0' }))).toMatchObject({ ok: true, value: { amount: 0 } });
    expect(normalizeAdminClaimOperationalFeeForm(formData({ claimId: CLAIM_ID, expectedUpdatedAt: base.expectedUpdatedAt, amount: '' })))
      .toMatchObject({ ok: true, value: { amount: null, feeKind: null } });
    expect(normalizeAdminClaimOperationalFeeForm(formData({ ...base, amount: '1000', evidence: '' }))).toMatchObject({ ok: false });
    expect(normalizeAdminClaimOperationalFeeForm(formData({ ...base, amount: '1000', evidence: `근거${String.fromCharCode(1)}` }))).toMatchObject({ ok: false });
  });
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

  it('수거 단계는 두 값만 받는다', () => {
    expect(normalizeAdminClaimCollectionForm(
      formData({ claimId: CLAIM_ID, stage: 'processing' }),
    )).toMatchObject({ ok: false });
    expect(normalizeAdminClaimCollectionForm(
      formData({ claimId: CLAIM_ID, stage: 'collected' }),
    )).toMatchObject({ ok: true, value: { stage: 'collected' } });
  });

  /* 레거시 회수 확인(T11b 리뷰 minor 4): 근거는 선택이고, 있으면 출고지별 회수 근거와 같은 규칙으로 좁혀 감사 기록에 남긴다. */
  it('레거시 회수 입고 확인은 선택 근거를 다듬어 받고, 길거나 표시할 수 없는 문자는 거절한다', () => {
    expect(normalizeAdminClaimCollectionForm(formData({ claimId: CLAIM_ID, stage: 'collected', receivedOn: '2026-01-02', evidence: ' 창고 회신 R-9 대조 ' })))
      .toEqual({ ok: true, value: { claimId: CLAIM_ID, stage: 'collected', receivedOn: '2026-01-02', evidence: '창고 회신 R-9 대조' } });
    expect(normalizeAdminClaimCollectionForm(formData({ claimId: CLAIM_ID, stage: 'collected' })))
      .toEqual({ ok: true, value: { claimId: CLAIM_ID, stage: 'collected', receivedOn: null, evidence: null } });
    expect(normalizeAdminClaimCollectionForm(formData({ claimId: CLAIM_ID, stage: 'collected', evidence: '가'.repeat(501) })).ok).toBe(false);
    expect(normalizeAdminClaimCollectionForm(formData({ claimId: CLAIM_ID, stage: 'collected', evidence: `근거${String.fromCharCode(1)}` })).ok).toBe(false);
  });

  it('클레임 id가 uuid가 아니면 거절한다', () => {
    expect(normalizeAdminClaimDecisionForm(
      formData({ claimId: 'not-a-uuid', decision: 'approve' }),
    )).toMatchObject({ ok: false });
  });
});

/* F-10: 목록에 보이는 요청번호 'C00021'을 그대로 붙여 넣어도 찾아져야 한다. DB는 숫자 글자로 비교하므로 DB가 받는 값('21')으로 바꿔 보낸다. */
describe('요청번호 검색어', () => {
  it('화면에 보이는 요청번호는 앞의 C와 0을 떼어 DB가 받는 숫자로 바꾼다 — 표시 형식(orderClaimReferenceLabel)의 역이다', () => {
    expect(adminClaimSearchQuery('C00021')).toBe('21');
    expect(adminClaimSearchQuery('c00021')).toBe('21');
    expect(adminClaimSearchQuery('  C00021  ')).toBe('21');
    expect(adminClaimSearchQuery('C21')).toBe('21');
    expect(adminClaimSearchQuery('C00100')).toBe('100');
    expect(adminClaimSearchQuery('C123456')).toBe('123456');
    /* 화면이 만드는 모든 번호가 되돌아온다. */
    for (const reference of [1, 9, 21, 100, 99999, 100000, 1234567]) expect(adminClaimSearchQuery(orderClaimReferenceLabel(reference))).toBe(String(reference));
  });

  it("요청번호를 찾는 '전체'·'주문·요청번호' 검색에서만 바꾸고, 그 밖의 검색 항목은 적은 그대로 보낸다", () => {
    expect(adminClaimSearchQuery('C00021', undefined)).toBe('21');
    expect(adminClaimSearchQuery('C00021', 'order')).toBe('21');
    for (const field of ['buyer', 'email', 'recipient', 'item'] as const) expect(adminClaimSearchQuery('C00021', field)).toBe('C00021');
  });

  it('요청번호 모양이 아니면 그대로 둔다 — 숫자만, 번호가 아닌 글, 0, 다른 글자가 섞인 값', () => {
    for (const query of ['21', '00021', '', 'C', 'C0', 'C00', 'C-21', 'C00021A', 'CC00021', 'C 00021', 'X00021', '20261126-0000012', 'abc']) {
      expect(adminClaimSearchQuery(query), query).toBe(query.trim());
    }
  });
});

/* F-14: 회수 확인 창·결과 글의 입고일도 목록·상세와 같은 날짜 표기("2026. 11. 26.")로 보인다. */
describe('입고일 표기', () => {
  it('날짜 칸의 값(YYYY-MM-DD)을 목록·상세가 쓰는 표기로 바꾼다 — 월·일의 앞자리 0은 붙이지 않는다', () => {
    expect(adminClaimReceivedOnLabel('2026-11-26')).toBe('2026. 11. 26.');
    expect(adminClaimReceivedOnLabel('2026-01-02')).toBe('2026. 1. 2.');
    expect(adminClaimReceivedOnLabel('2026-12-31')).toBe('2026. 12. 31.');
  });

  it('날짜로 읽을 수 없는 값은 받은 그대로 둔다', () => {
    expect(adminClaimReceivedOnLabel('')).toBe('');
    expect(adminClaimReceivedOnLabel('오늘')).toBe('오늘');
  });
});
