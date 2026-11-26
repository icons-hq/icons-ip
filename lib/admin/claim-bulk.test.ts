import { describe, expect, it, vi } from 'vitest';
import {
  ADMIN_CLAIM_BULK_ACTION_LABELS,
  ADMIN_CLAIM_BULK_DB_ITEM_RESERVE_MS,
  ADMIN_CLAIM_BULK_DEADLINE_MS,
  ADMIN_CLAIM_BULK_LIMIT,
  ADMIN_CLAIM_BULK_OUTCOME_LABELS,
  ADMIN_CLAIM_BULK_PROVIDER_ITEM_RESERVE_MS,
  ADMIN_CLAIM_BULK_STEP_LABELS,
  ADMIN_CLAIM_BULK_TIME_BUDGET_MS,
  ADMIN_CLAIM_BULK_CONVERT_ITEM_RESERVE_MS,
  adminClaimBulkApproveEffect,
  adminClaimBulkApproveTotals,
  adminClaimBulkConfirmation,
  adminClaimBulkConversionLabel,
  adminClaimBulkConversionTarget,
  adminClaimBulkDecisionBlocker,
  adminClaimBulkDecisionUnavailable,
  adminClaimBulkNeedsPreview,
  adminClaimBulkSelectable,
  adminClaimBulkSummary,
  adminClaimBulkTimeoutMessage,
  normalizeAdminClaimBulkConversionForm,
  normalizeAdminClaimBulkForm,
  planAdminClaimBulkSubmit,
  runAdminClaimBulkSequentially,
  ADMIN_CLAIM_BULK_REFUND_ITEM_RESERVE_MS,
  adminClaimBulkCollectPlan,
  adminClaimBulkCollectTargetKey,
  adminClaimBulkCollectTargetLabel,
  adminClaimBulkContinuation,
  adminClaimBulkProviderLabel,
  adminClaimBulkRefundTotals,
  adminClaimBulkReshipRowError,
  adminClaimBulkSteps,
  normalizeAdminClaimBulkApprovePreviewInput,
  normalizeAdminClaimBulkCollectInput,
  normalizeAdminClaimBulkRefundInput,
  normalizeAdminClaimBulkStepPreviewInput,
  parseAdminClaimBulkContexts,
  adminClaimBulkRefundBlockerMessage,
  type AdminClaimBulkContext,
} from './claim-bulk';
import { mergeClaimBulkResults, runClaimBulkInChunks } from '@/components/admin/screens/ClaimBulkStepDialog';

const ID = (n: number) => `abcdef${String(n).padStart(2, '0')}-1234-4123-8123-123456789abc`;

function form(entries: [string, string][]) {
  const data = new FormData();
  for (const [key, value] of entries) data.append(key, value);
  return data;
}

describe('normalizeAdminClaimBulkConversionForm', () => {
  const valid: [string, string][] = [['claimType', 'return'], ['claimIds', ID(1)], ['agreement', '  11/9 전화 상담으로 합의  ']];
  const replace = (name: string, value: string) => form([...valid.filter(([key]) => key !== name), [name, value]]);

  it('전환 방향과 라벨을 정하고, 합의 근거를 다듬어 선택을 중복 없이 넘긴다', () => {
    expect(adminClaimBulkConversionTarget('return')).toBe('exchange');
    expect(adminClaimBulkConversionTarget('exchange')).toBe('return');
    expect(adminClaimBulkConversionLabel('return')).toBe('교환으로 바꾸기');
    expect(adminClaimBulkConversionLabel('exchange')).toBe('반품으로 바꾸기');
    expect(normalizeAdminClaimBulkConversionForm(form([...valid, ['claimIds', ID(1).toUpperCase()], ['claimIds', ID(2)]]))).toEqual({
      ok: true,
      value: { claimIds: [ID(1), ID(2)], fromType: 'return', agreement: '11/9 전화 상담으로 합의' },
    });
  });

  it('취소·잘못된 유형, 합의 근거 길이·제어문자는 거절한다', () => {
    expect(normalizeAdminClaimBulkConversionForm(replace('claimType', 'cancel'))).toEqual({ ok: false, error: '반품과 교환 요청만 서로 전환할 수 있습니다.' });
    for (const agreement of ['한', 'ㄱ'.repeat(501), '합의\n내용']) {
      expect(normalizeAdminClaimBulkConversionForm(replace('agreement', agreement))).toEqual({ ok: false, error: '고객 합의 근거를 2자 이상 500자 이하로 입력해주세요.' });
    }
  });

  /* '모두 합의했습니다' 체크는 어디에도 저장되지 않는다 — 합의는 근거 글이 말하고, 체크 값은 보내도 보내지 않아도 같다. */
  it('합의 확인 체크 값은 받지도 따지지도 않는다', () => {
    const expected = { ok: true, value: { claimIds: [ID(1)], fromType: 'return', agreement: '11/9 전화 상담으로 합의' } };
    expect(normalizeAdminClaimBulkConversionForm(form(valid))).toEqual(expected);
    expect(normalizeAdminClaimBulkConversionForm(replace('confirmed', 'false'))).toEqual(expected);
  });

  it('선택이 없거나 50건을 넘기면 결정 일괄 처리와 같은 안내로 막는다', () => {
    const others = valid.filter(([key]) => key !== 'claimIds');
    expect(normalizeAdminClaimBulkConversionForm(form(others))).toEqual({ ok: false, error: '처리할 요청을 선택해주세요.' });
    const many: [string, string][] = Array.from({ length: ADMIN_CLAIM_BULK_LIMIT + 1 }, (_, index) => ['claimIds', ID(index)]);
    expect(normalizeAdminClaimBulkConversionForm(form([...others, ...many]))).toMatchObject({ ok: false });
  });

  it('전환 한 건은 DB 호출이 둘이라 결정 한 건의 두 배 시간을 예약한다', () => {
    expect(ADMIN_CLAIM_BULK_CONVERT_ITEM_RESERVE_MS).toBe(ADMIN_CLAIM_BULK_DB_ITEM_RESERVE_MS * 2);
  });
});

describe('normalizeAdminClaimBulkForm', () => {
  it('선택한 요청을 중복 없이 소문자로 좁히고 승인·검토중에는 사유를 보내지 않는다', () => {
    const result = normalizeAdminClaimBulkForm(form([
      ['claimIds', ID(1).toUpperCase()],
      ['claimIds', ID(1)],
      ['claimIds', ` ${ID(2)} `],
      ['decision', 'approve'],
      ['note', '쓰이지 않는 사유입니다 열 자 이상'],
    ]));
    expect(result).toEqual({ ok: true, value: { claimIds: [ID(1), ID(2)], decision: 'approve', note: null } });
  });

  it('한 번에 50건을 넘기면 처리하지 않는다', () => {
    const entries: [string, string][] = Array.from({ length: ADMIN_CLAIM_BULK_LIMIT + 1 }, (_, index) => ['claimIds', ID(index)]);
    expect(ADMIN_CLAIM_BULK_LIMIT).toBe(50);
    expect(normalizeAdminClaimBulkForm(form([...entries, ['decision', 'review']]))).toEqual({
      ok: false,
      error: '한 번에 50건까지 처리할 수 있습니다. 선택을 줄여 다시 실행해주세요.',
    });
  });

  it('선택이 없거나 식별자가 잘못되면 거절한다', () => {
    expect(normalizeAdminClaimBulkForm(form([['decision', 'review']]))).toMatchObject({ ok: false, error: '처리할 요청을 선택해주세요.' });
    expect(normalizeAdminClaimBulkForm(form([['claimIds', 'not-a-uuid'], ['decision', 'review']]))).toMatchObject({ ok: false });
  });

  it('보류·해제·회수·환불은 일괄 결정으로 받지 않는다', () => {
    for (const decision of ['hold', 'resume', 'collect', 'refund', '']) {
      expect(normalizeAdminClaimBulkForm(form([['claimIds', ID(1)], ['decision', decision]]))).toMatchObject({ ok: false, error: '처리할 작업을 선택해주세요.' });
    }
  });

  it('거부는 공통 사유를 앞뒤 공백 없이 10~200자로 받는다', () => {
    expect(normalizeAdminClaimBulkForm(form([['claimIds', ID(1)], ['decision', 'reject'], ['note', '짧은 사유']]))).toMatchObject({
      ok: false,
      error: '거부 사유를 10자 이상 200자 이하로 입력해주세요.',
    });
    expect(normalizeAdminClaimBulkForm(form([['claimIds', ID(1)], ['decision', 'reject'], ['note', '  이미 발송되어 취소할 수 없습니다.  ']]))).toEqual({
      ok: true,
      value: { claimIds: [ID(1)], decision: 'reject', note: '이미 발송되어 취소할 수 없습니다.' },
    });
  });
});

describe('runAdminClaimBulkSequentially', () => {
  it('건마다 앞 건이 끝난 뒤에 다음 건을 시작한다(같은 결제의 취소가 겹치지 않는다)', async () => {
    const events: string[] = [];
    let active = 0;
    let maxActive = 0;
    const results = await runAdminClaimBulkSequentially(
      [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      async (item) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        events.push(`start:${item.id}`);
        await new Promise((resolve) => setTimeout(resolve, 1));
        events.push(`end:${item.id}`);
        active -= 1;
        return { ok: true, message: `${item.id} 처리` };
      },
    );
    expect(maxActive).toBe(1);
    expect(events).toEqual(['start:a', 'end:a', 'start:b', 'end:b', 'start:c', 'end:c']);
    expect(results.map((result) => result.outcome)).toEqual(['done', 'done', 'done']);
  });

  it('한 건이 실패해도 나머지 건을 계속 처리하고 실패 사유를 남긴다', async () => {
    const results = await runAdminClaimBulkSequentially(
      [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      async (item) => {
        if (item.id === 'b') return { ok: false, message: '지금 단계에서는 처리할 수 없습니다.' };
        if (item.id === 'c') throw new Error('network');
        return { ok: true, message: '처리했습니다.' };
      },
    );
    expect(results).toEqual([
      { item: { id: 'a' }, outcome: 'done', message: '처리했습니다.' },
      { item: { id: 'b' }, outcome: 'failed', message: '지금 단계에서는 처리할 수 없습니다.' },
      { item: { id: 'c' }, outcome: 'failed', message: '클레임을 처리하지 못했습니다. 최신 상태를 확인해주세요.' },
    ]);
  });

  it('시간 예산(45초)을 넘기면 남은 건을 시작하지 않고 미처리로 돌려준다', async () => {
    expect(ADMIN_CLAIM_BULK_TIME_BUDGET_MS).toBe(45_000);
    let now = 0;
    const started: string[] = [];
    const results = await runAdminClaimBulkSequentially(
      [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }],
      async (item) => {
        started.push(item.id);
        now += 20_000;
        return { ok: true, message: '처리했습니다.' };
      },
      { clock: () => now, reserveMs: ADMIN_CLAIM_BULK_DB_ITEM_RESERVE_MS },
    );
    expect(started).toEqual(['a', 'b', 'c']);
    expect(results.map((result) => result.outcome)).toEqual(['done', 'done', 'done', 'skipped']);
    expect(results[3].message).toBe('처리 시간이 길어 처리하지 않았습니다. 다시 실행하세요.');
  });

  it('건당 최악 시간이 마감(목록 maxDuration 60초 − 응답 여유) 안에 끝날 때만 다음 건을 시작한다', async () => {
    expect(ADMIN_CLAIM_BULK_DEADLINE_MS).toBe(55_000);
    expect(ADMIN_CLAIM_BULK_PROVIDER_ITEM_RESERVE_MS).toBe(30_000);
    expect(ADMIN_CLAIM_BULK_TIME_BUDGET_MS + ADMIN_CLAIM_BULK_DB_ITEM_RESERVE_MS).toBeLessThanOrEqual(ADMIN_CLAIM_BULK_DEADLINE_MS);
    /* 리뷰 재현: 44.9초에 토스 취소 건을 시작하면 사전 조회·취소·사후 조회가 길어질 때 60초를 넘긴다. */
    let now = 0;
    const durations: Record<string, number> = { a: 44_900, b: 24_500, c: 1_000 };
    const started: string[] = [];
    const results = await runAdminClaimBulkSequentially(['a', 'b', 'c'], async (item) => {
      started.push(item);
      now += durations[item];
      return { ok: true, message: '처리했습니다.' };
    }, { clock: () => now });
    expect(started).toEqual(['a']);
    expect(now).toBeLessThanOrEqual(60_000);
    expect(results.map((result) => result.outcome)).toEqual(['done', 'skipped', 'skipped']);
  });

  it('시계는 액션 진입 시점(startedAt)부터 잰다 — 인증·조회에 쓴 시간도 예산에 든다', async () => {
    let now = 26_000;
    const worker = vi.fn(async () => ({ ok: true, message: '처리했습니다.' }));
    const late = await runAdminClaimBulkSequentially(['a', 'b'], worker, { clock: () => now, startedAt: 0 });
    expect(worker).not.toHaveBeenCalled();
    expect(late.map((result) => result.outcome)).toEqual(['skipped', 'skipped']);

    now = 24_000;
    const inTime = await runAdminClaimBulkSequentially(['a'], worker, { clock: () => now, startedAt: 0 });
    expect(worker).toHaveBeenCalledTimes(1);
    expect(inTime[0].outcome).toBe('done');
  });

  it('한 번 미처리가 나오면 남은 건은 시작하지 않는다(순서를 건너뛰지 않는다)', async () => {
    let now = 0;
    const reserves: Record<string, number> = { a: 1_000, b: 30_000, c: 1_000 };
    const started: string[] = [];
    const results = await runAdminClaimBulkSequentially(['a', 'b', 'c'], async (item) => {
      started.push(item);
      now += 30_000;
      return { ok: true, message: '처리했습니다.' };
    }, { clock: () => now, reserveMs: (item) => reserves[item] });
    expect(started).toEqual(['a']);
    expect(results.map((result) => result.outcome)).toEqual(['done', 'skipped', 'skipped']);
  });
});

describe('일괄 처리 문구', () => {
  it('아직 안 한 건수를 확정 문구로 알리고, 처리됨·실패·건너뜀을 나눠 센다', () => {
    expect(adminClaimBulkTimeoutMessage(3)).toBe('처리 시간이 길어 3건은 처리하지 않았습니다. 다시 실행하세요.');
    expect(adminClaimBulkSummary(['done', 'failed', 'skipped', 'skipped'])).toBe(
      '처리됨 1건 · 실패 1건 · 처리 시간이 길어 2건은 처리하지 않았습니다. 다시 실행하세요.',
    );
    expect(adminClaimBulkSummary(['done', 'done'])).toBe('처리됨 2건 · 실패 0건');
    expect(adminClaimBulkSummary(['done', 'excluded', 'excluded', 'failed'])).toBe('처리됨 1건 · 실패 1건 · 건너뜀 2건');
  });

  /* 결과 이름은 목록 일괄 처리가 한 벌만 쓴다. 상품 일괄 변경의 '건너뜀'과 같은 말이다. */
  it('버튼·결과 이름에 내부 말(선택 건·미처리·제외)이 없다', () => {
    expect(ADMIN_CLAIM_BULK_OUTCOME_LABELS).toEqual({ done: '처리됨', failed: '실패', skipped: '아직 안 함', excluded: '건너뜀' });
    expect(Object.values(ADMIN_CLAIM_BULK_ACTION_LABELS)).toEqual(['승인', '거부', '검토중으로 표시']);
    expect(Object.values(ADMIN_CLAIM_BULK_STEP_LABELS)).toEqual(['회수 확인', '환불 완료 확정', '재출고']);
    for (const label of [...Object.values(ADMIN_CLAIM_BULK_ACTION_LABELS), ...Object.values(ADMIN_CLAIM_BULK_STEP_LABELS)]) expect(label).not.toContain('선택 건');
  });

  it('반품·교환 승인 확인창은 건수와 회수 시작을 말하고, 자동 회수가 켜져 있을 때만 택배사 접수를 말한다', () => {
    const plain = adminClaimBulkConfirmation('return', 'approve', { count: 2 });
    expect(plain).toMatchObject({ title: '2건 승인', confirmLabel: '2건 승인', cancelLabel: '돌아가기' });
    expect(plain.message).toBe('선택한 2건을 승인하고 회수를 시작합니다.');
    expect(adminClaimBulkConfirmation('exchange', 'approve', { count: 2, autoPickup: true }).message)
      .toContain('회수 계약 출고지는 몇 분 안에 택배사에 회수가 접수됩니다.');
    expect(adminClaimBulkConfirmation('return', 'approve', { count: 2, autoPickup: false }).message).not.toContain('택배사');
  });

  it('거부 확인창은 구매자에게 가는 사유 원문과 되돌릴 수 없음을 말하고 위험색 버튼이다', () => {
    const request = adminClaimBulkConfirmation('exchange', 'reject', { count: 4, note: '교환할 옵션의 재고가 없어 교환할 수 없습니다.' });
    expect(request).toMatchObject({ title: '4건 거부', confirmLabel: '4건 거부', cancelLabel: '돌아가기', destructive: true });
    expect(request.message).toContain('구매자에게 그대로 전달됩니다.');
    expect(request.message).toContain('"교환할 옵션의 재고가 없어 교환할 수 없습니다."');
    expect(request.message).toContain('거부하면 되돌릴 수 없습니다.');
  });

  it('건너뛰는 건은 앞의 다섯 건만 이유와 함께 적고 나머지는 건수로 줄인다', () => {
    const skipped = Array.from({ length: 7 }, (_, index) => ({ claimId: ID(index), reference: `C0000${index}`, message: '이미 승인한 요청입니다.' }));
    const { message } = adminClaimBulkConfirmation('return', 'review', { count: 3, skipped });
    expect(message).toContain('선택한 10건 중 3건을 검토중으로 표시합니다.');
    expect(message).toContain('건너뛰는 7건');
    expect(message).toContain('· C00000 — 이미 승인한 요청입니다.');
    expect(message).toContain('· C00004 — 이미 승인한 요청입니다.');
    expect(message).not.toContain('C00005');
    expect(message).toContain('· 그 밖에 2건');
  });

  /* 이전 문구는 나이스페이 결제에도 '토스 전액 취소'라고 말했다. 결제사 이름은 이름표에서 읽는다. */
  it('결제사 이름을 문장에 직접 적지 않고 이름표에서 읽는다', () => {
    expect(adminClaimBulkConfirmation('cancel', 'approve', { count: 1 }).message).toContain('토스·나이스페이');
    expect(adminClaimBulkApproveEffect('toss')).toEqual({ providerCancel: true, effect: '승인하고 토스 전액 취소를 요청합니다' });
    expect(adminClaimBulkApproveEffect('nicepay')).toEqual({ providerCancel: true, effect: '승인하고 나이스페이 전액 취소를 요청합니다' });
    expect(adminClaimBulkProviderLabel('nicepay')).toBe('나이스페이');
    expect(adminClaimBulkProviderLabel('some_future_pg')).toBe('그 밖의 결제');
    expect(adminClaimBulkProviderLabel(null)).toBe('결제 없음');
  });
});

describe('일괄 승인·거부·검토중이 지금 단계에서 되는지(L-07)', () => {
  it('검토중 표시는 요청 단계만, 승인은 요청·검토중만 쓴다 — DB(decide_order_claim)와 같다', () => {
    expect(adminClaimBulkDecisionBlocker('review', 'requested')).toBeNull();
    expect(adminClaimBulkDecisionBlocker('review', 'in_review')).toBe('이미 검토중인 요청입니다.');
    expect(adminClaimBulkDecisionBlocker('approve', 'requested')).toBeNull();
    expect(adminClaimBulkDecisionBlocker('approve', 'in_review')).toBeNull();
    expect(adminClaimBulkDecisionBlocker('approve', 'collecting')).toBe('이미 승인한 요청입니다.');
    expect(adminClaimBulkDecisionBlocker('approve', 'on_hold')).toBe('보류 중인 요청입니다. 보류를 푼 뒤 승인해주세요.');
    expect(adminClaimBulkDecisionBlocker('review', 'on_hold')).toContain('보류 중인 요청입니다.');
    for (const decision of ['approve', 'review', 'reject'] as const) {
      expect(adminClaimBulkDecisionBlocker(decision, 'completed')).toBe('이미 처리가 끝난 요청입니다.');
      expect(adminClaimBulkDecisionBlocker(decision, 'rejected')).toBe('거부·철회로 끝난 요청입니다.');
      expect(adminClaimBulkDecisionBlocker(decision, 'withdrawn')).toBe('거부·철회로 끝난 요청입니다.');
    }
  });

  it('거부는 환불에 들어가기 전까지 쓰고, 보류 중인 요청은 보류 전 단계에 달려 DB에 맡긴다', () => {
    for (const stage of ['requested', 'in_review', 'collecting', 'collected'] as const) expect(adminClaimBulkDecisionBlocker('reject', stage)).toBeNull();
    expect(adminClaimBulkDecisionBlocker('reject', 'processing')).toBe('환불을 진행 중이라 거부할 수 없습니다.');
    expect(adminClaimBulkDecisionBlocker('reject', 'needs_review')).toBe('환불을 진행 중이라 거부할 수 없습니다.');
    expect(adminClaimBulkDecisionBlocker('reject', 'on_hold')).toBeNull();
  });

  it('고른 건이 모두 막혔을 때의 이유와, 취소 승인만 미리보기 확인창을 쓴다', () => {
    expect(adminClaimBulkDecisionUnavailable('approve')).toBe('선택한 요청은 모두 지금 단계에서 승인할 수 없습니다.');
    expect(adminClaimBulkDecisionUnavailable('review')).toBe('선택한 요청은 모두 지금 단계에서 검토중으로 표시할 수 없습니다.');
    expect(adminClaimBulkNeedsPreview('cancel', 'approve')).toBe(true);
    expect(adminClaimBulkNeedsPreview('return', 'approve')).toBe(false);
    expect(adminClaimBulkNeedsPreview('cancel', 'reject')).toBe(false);
  });
});

describe('취소 일괄 승인 확인창 값(L-08)', () => {
  const row = (claimId: string, amount: number | null, providerLabel: string, providerCancel: boolean, blocker: string | null = null) =>
    ({ claimId, reference: `C0000${claimId.slice(-1)}`, providerLabel, amount, providerCancel, effect: '', blocker });

  it('승인할 건만 세어 취소 금액 합계를 결제 방식별로 내고, 결제가 없는 주문은 건수만 센다', () => {
    expect(adminClaimBulkApproveTotals([
      row(ID(1), 30000, '토스 결제', true),
      row(ID(2), 20000, '나이스페이', true),
      row(ID(3), 5000, '토스 결제', true),
      row(ID(4), 7000, '무통장 입금', false),
      row(ID(5), null, '결제 없음', false),
      row(ID(6), 9999, '토스 결제', true, '이미 승인한 요청입니다.'),
    ])).toEqual({
      count: 5, amount: 62000,
      byProvider: [
        { label: '토스 결제', count: 2, amount: 35000, providerCancel: true },
        { label: '나이스페이', count: 1, amount: 20000, providerCancel: true },
        { label: '무통장 입금', count: 1, amount: 7000, providerCancel: false },
        { label: '결제 없음', count: 1, amount: 0, providerCancel: false },
      ],
    });
  });

  it('승인 뒤에 일어나는 일은 코드가 가르는 대로다 — 무통장·코페이·결제 없음은 승인만 한다', () => {
    expect(adminClaimBulkApproveEffect('bank_transfer')).toMatchObject({ providerCancel: false, effect: expect.stringContaining('계좌 송금') });
    expect(adminClaimBulkApproveEffect('korpay')).toMatchObject({ providerCancel: false, effect: expect.stringContaining('접수 양식') });
    expect(adminClaimBulkApproveEffect(null)).toMatchObject({ providerCancel: false, effect: expect.stringContaining('결제 전 주문') });
  });

  it('열기 요청은 취소 목록의 50건 안 선택만 받는다', () => {
    expect(normalizeAdminClaimBulkApprovePreviewInput({ claimType: 'cancel', claimIds: [ID(1), ID(1).toUpperCase(), ID(2)] }))
      .toEqual({ ok: true, value: { claimType: 'cancel', claimIds: [ID(1), ID(2)] } });
    expect(normalizeAdminClaimBulkApprovePreviewInput({ claimType: 'return', claimIds: [ID(1)] }).ok).toBe(false);
    expect(normalizeAdminClaimBulkApprovePreviewInput({ claimType: 'cancel', claimIds: [] }).ok).toBe(false);
    expect(normalizeAdminClaimBulkApprovePreviewInput({ claimType: 'cancel', claimIds: Array.from({ length: ADMIN_CLAIM_BULK_LIMIT + 1 }, (_, n) => ID(n)) }).ok).toBe(false);
    expect(normalizeAdminClaimBulkApprovePreviewInput(null).ok).toBe(false);
  });
});

describe('adminClaimBulkSelectable', () => {
  it('승인·거부·검토중이 가능한 단계만 고를 수 있다', () => {
    expect(adminClaimBulkSelectable('cancel', 'requested')).toBe(true);
    expect(adminClaimBulkSelectable('cancel', 'in_review')).toBe(true);
    expect(adminClaimBulkSelectable('cancel', 'on_hold')).toBe(true);
    /* 환불 완료 확정(1027T-033)은 처리중·결제확인필요 건에도 쓴다. 교환에는 환불이 없다. */
    expect(adminClaimBulkSelectable('cancel', 'processing')).toBe(true);
    expect(adminClaimBulkSelectable('cancel', 'needs_review')).toBe(true);
    expect(adminClaimBulkSelectable('return', 'processing')).toBe(true);
    expect(adminClaimBulkSelectable('exchange', 'processing')).toBe(false);
    expect(adminClaimBulkSelectable('exchange', 'needs_review')).toBe(false);
    expect(adminClaimBulkSelectable('return', 'collecting')).toBe(true);
    expect(adminClaimBulkSelectable('exchange', 'collected')).toBe(true);
    expect(adminClaimBulkSelectable('return', 'completed')).toBe(false);
    expect(adminClaimBulkSelectable('return', 'withdrawn')).toBe(false);
  });
});

describe('planAdminClaimBulkSubmit', () => {
  const allow = () => true;
  const pick = (n: number, stage: 'requested' | 'in_review' | 'collecting' | 'processing' | 'on_hold' = 'requested') => ({ id: ID(n), reference: `C0000${n}`, stage });
  it('선택·작업·거부 사유를 서버에 보내기 전에 확인한다', async () => {
    expect(await planAdminClaimBulkSubmit({ claimType: 'cancel', picks: [], decision: 'review', note: '' }, allow)).toEqual({ kind: 'invalid', error: '처리할 요청을 선택해주세요.' });
    expect(await planAdminClaimBulkSubmit({ claimType: 'cancel', picks: Array.from({ length: 51 }, (_, n) => pick(n)), decision: 'review', note: '' }, allow)).toMatchObject({ kind: 'invalid' });
    expect(await planAdminClaimBulkSubmit({ claimType: 'cancel', picks: [pick(1)], decision: null, note: '' }, allow)).toEqual({ kind: 'invalid', error: '처리할 작업을 선택해주세요.' });
    expect(await planAdminClaimBulkSubmit({ claimType: 'cancel', picks: [pick(1), pick(2)], decision: 'reject', note: ' 짧다 ' }, allow)).toEqual({ kind: 'invalid', error: '거부 사유를 10자 이상 200자 이하로 입력해주세요.' });
  });

  it('누른 작업의 확인창으로 묻고, 취소하면 보내지 않는다', async () => {
    const asked: string[] = [];
    const deny = (request: { title?: string; message: string }) => { asked.push(`${request.title}|${request.message}`); return false; };
    expect(await planAdminClaimBulkSubmit({ claimType: 'return', picks: [pick(1), pick(2), pick(3)], decision: 'approve', note: '' }, deny)).toEqual({ kind: 'dismissed' });
    expect(asked[0]).toBe(`3건 승인|${adminClaimBulkConfirmation('return', 'approve', { count: 3 }).message}`);
    expect(await planAdminClaimBulkSubmit({ claimType: 'return', picks: [pick(1), pick(2)], decision: 'reject', note: '반품 가능 기간이 지났습니다.' }, allow))
      .toEqual({ kind: 'submit', decision: 'reject', claimIds: [ID(1), ID(2)], skipped: [] });
  });

  /* L-07: 누른 뒤 서버가 '지금 단계에서는 처리할 수 없습니다'로 거절하지 않고, 확인창이 미리 빼서 이유와 함께 말한다. */
  it('지금 단계에서 안 되는 건은 보내지 않고 이유와 함께 건너뛴다', async () => {
    let request: { message: string } | null = null;
    const plan = await planAdminClaimBulkSubmit(
      { claimType: 'return', picks: [pick(1, 'requested'), pick(2, 'collecting'), pick(3, 'in_review'), pick(4, 'on_hold')], decision: 'approve', note: '' },
      (asked) => { request = asked; return true; },
    );
    expect(plan).toEqual({
      kind: 'submit', decision: 'approve', claimIds: [ID(1), ID(3)],
      skipped: [
        { claimId: ID(2), reference: 'C00002', message: '이미 승인한 요청입니다.' },
        { claimId: ID(4), reference: 'C00004', message: '보류 중인 요청입니다. 보류를 푼 뒤 승인해주세요.' },
      ],
    });
    expect(request!.message).toContain('선택한 4건 중 2건을 승인하고 회수를 시작합니다.');
    expect(request!.message).toContain('건너뛰는 2건');
    expect(request!.message).toContain('· C00002 — 이미 승인한 요청입니다.');
  });

  it('고른 건이 모두 안 되면 확인창을 띄우지 않고 이유를 돌려준다', async () => {
    const ask = vi.fn(() => true);
    expect(await planAdminClaimBulkSubmit({ claimType: 'return', picks: [pick(1, 'processing'), pick(2, 'collecting')], decision: 'review', note: '' }, ask))
      .toEqual({ kind: 'invalid', error: '선택한 요청은 모두 지금 단계에서 검토중으로 표시할 수 없습니다.' });
    expect(ask).not.toHaveBeenCalled();
  });

  it('거부는 환불에 들어간 건을 빼고 보류 중인 건은 DB 판정에 맡겨 보낸다', async () => {
    const plan = await planAdminClaimBulkSubmit(
      { claimType: 'return', picks: [pick(1, 'collecting'), pick(2, 'processing'), pick(3, 'on_hold')], decision: 'reject', note: '회수한 상품에 사용 흔적이 있어 반품할 수 없습니다.' }, allow);
    expect(plan).toMatchObject({ kind: 'submit', claimIds: [ID(1), ID(3)], skipped: [{ claimId: ID(2), message: '환불을 진행 중이라 거부할 수 없습니다.' }] });
  });
});

/* 단계 일괄 처리(1027T-033·SHEET-049·SHEET-052). */
const SHIP = (n: number) => `5a1e0000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
function context(overrides: Partial<AdminClaimBulkContext> = {}): AdminClaimBulkContext {
  return {
    claimId: ID(1), reference: 1, orderId: ID(9), claimType: 'return', stage: 'collecting', collectionPolicy: 'origin', collectionRequired: true,
    collections: [], paymentProvider: 'toss', refundAmount: 1000, refundBlocker: null, ...overrides,
  };
}
function origin(n: number, overrides: Partial<AdminClaimBulkContext['collections'][number]> = {}) {
  return { shipmentId: SHIP(n), originName: `출고지 ${n}`, collectedAt: null, receivedOn: null, waived: false, returnAddressReady: true, ...overrides };
}

describe('단계 일괄 처리 — 목록별 단계와 안내', () => {
  it('취소는 환불만, 반품은 회수·환불, 교환은 회수·재출고를 쓴다', () => {
    expect(adminClaimBulkSteps('cancel')).toEqual(['refund']);
    expect(adminClaimBulkSteps('return')).toEqual(['collect', 'refund']);
    expect(adminClaimBulkSteps('exchange')).toEqual(['collect', 'reship']);
  });

  it('환불 한 건은 결제사 취소에 환불 접수까지 더한 시간을 예약한다', () => {
    expect(ADMIN_CLAIM_BULK_REFUND_ITEM_RESERVE_MS).toBe(ADMIN_CLAIM_BULK_PROVIDER_ITEM_RESERVE_MS + ADMIN_CLAIM_BULK_DB_ITEM_RESERVE_MS);
  });
});

describe('parseAdminClaimBulkContexts', () => {
  it('서버 사실을 좁히고 모양이 어긋나면 전부 버린다', () => {
    const raw = { claimId: ID(1), reference: '7', orderId: ID(9), claimType: 'return', stage: 'collected', collectionPolicy: 'origin', collectionRequired: true,
      collections: [{ shipmentId: SHIP(1), originName: '김포', collectedAt: null, receivedOn: null, waived: true, returnAddressReady: true }],
      paymentProvider: 'toss', refundAmount: '5000', refundBlocker: null };
    expect(parseAdminClaimBulkContexts([raw])).toEqual([expect.objectContaining({ reference: 7, refundAmount: 5000, collections: [expect.objectContaining({ waived: true })] })]);
    expect(parseAdminClaimBulkContexts([{ ...raw, stage: 'unknown' }])).toBeNull();
    expect(parseAdminClaimBulkContexts([{ ...raw, refundAmount: -1 }])).toBeNull();
    expect(parseAdminClaimBulkContexts([{ ...raw, collections: [{ shipmentId: 'x', originName: '김포', collectedAt: null, receivedOn: null }] }])).toBeNull();
    expect(parseAdminClaimBulkContexts({})).toBeNull();
  });

  /* CLM-136: 부분 반품은 남은 결제 금액이 아니라 고른 몫(차감 뒤)을 싣고, 표시를 위해 부분 반품임을 함께 넘긴다. */
  it('부분 반품 표시와 고른 몫의 반품배송비 차감을 읽는다', () => {
    const raw = { claimId: ID(1), reference: 7, orderId: ID(9), claimType: 'return', stage: 'collected', collectionPolicy: 'origin', collectionRequired: true,
      collections: [], paymentProvider: 'toss', refundAmount: 6500, refundBlocker: null, partialReturn: true,
      refundDeduction: { source: 'partial_return', applicable: true, deductionAmount: 3000 } };
    expect(parseAdminClaimBulkContexts([raw])).toEqual([expect.objectContaining({ refundAmount: 6500, refundDeductionAmount: 3000, partialReturn: true })]);
    const [whole] = parseAdminClaimBulkContexts([{ ...raw, partialReturn: undefined, refundDeduction: undefined }])!;
    expect(whole).not.toHaveProperty('partialReturn'); expect(whole).not.toHaveProperty('refundDeductionAmount');
    expect(adminClaimBulkRefundBlockerMessage('partial_return_in_progress')).toContain('[환불 완료 확정]');
    expect(adminClaimBulkRefundBlockerMessage('partial_return_plan_unavailable')).toContain('"부분 반품" 칸');
  });
});

describe('adminClaimBulkCollectPlan', () => {
  it('남은 출고지만 확인하고, 회수 생략·반송 주소 없음은 사유와 함께 남긴다', () => {
    const plan = adminClaimBulkCollectPlan(context({ collections: [
      origin(1), origin(2, { collectedAt: '2026-11-10T00:00:00Z' }), origin(3, { waived: true }), origin(4, { returnAddressReady: false }),
    ] }));
    expect(plan.targets).toEqual([{ shipmentId: SHIP(1), originName: '출고지 1' }]);
    expect(plan.skipped.map((entry) => entry.originName)).toEqual(['출고지 3', '출고지 4']);
    expect(plan.blocker).toBeNull();
  });

  it('남은 출고지가 없거나 회수 단계가 아니면 요청 전체를 뺀다', () => {
    expect(adminClaimBulkCollectPlan(context({ collections: [origin(1, { collectedAt: '2026-11-10T00:00:00Z' })] })).blocker).toBe('모든 출고지의 회수 확인이 이미 끝났습니다.');
    expect(adminClaimBulkCollectPlan(context({ collections: [origin(3, { waived: true })] })).blocker).toContain('회수 생략으로 결정한 출고지');
    expect(adminClaimBulkCollectPlan(context({ claimType: 'cancel' })).blocker).toBe('취소 요청에는 회수 확인이 없습니다.');
    expect(adminClaimBulkCollectPlan(context({ stage: 'on_hold' })).blocker).toContain('보류 중');
    expect(adminClaimBulkCollectPlan(context({ stage: 'in_review' })).blocker).toContain('승인 전');
    expect(adminClaimBulkCollectPlan(context({ stage: 'completed' })).blocker).toBe('종결된 요청입니다.');
    expect(adminClaimBulkCollectPlan(context({ collectionRequired: false })).blocker).toBe('회수가 필요하지 않은 요청입니다.');
  });

  /* S36-040: 반품지가 갈린 배송 건은 회수 묶음마다 한 줄로 고르고, 입고된 묶음은 빼며, 주소 없는 묶음은 사유와 남긴다. */
  it('반품지가 갈린 배송 건은 회수 묶음마다 확인 대상이다', () => {
    const bundle = (n: number, extra: Record<string, unknown> = {}) => ({ bundleId: SHIP(70 + n), returnName: '', collectedAt: null, returnAddressReady: true, ...extra });
    const plan = adminClaimBulkCollectPlan(context({ collections: [
      origin(1, { bundles: [bundle(1), bundle(2, { returnName: '서울 반품지' }), bundle(3, { returnName: '부산 반품지', collectedAt: '2026-11-10T00:00:00Z' }),
        bundle(4, { returnName: '제주 반품지', returnAddressReady: false })] }),
      origin(2, { bundles: [bundle(5)] }),
    ] }));
    expect(plan.targets).toEqual([
      { shipmentId: SHIP(1), originName: '출고지 1', bundleId: SHIP(71), returnName: '' },
      { shipmentId: SHIP(1), originName: '출고지 1', bundleId: SHIP(72), returnName: '서울 반품지' },
      { shipmentId: SHIP(2), originName: '출고지 2' },
    ]);
    expect(plan.skipped.map((entry) => entry.originName)).toEqual(['출고지 1 · 제주 반품지']);
    expect(plan.targets.map(adminClaimBulkCollectTargetLabel)).toEqual(['출고지 1 · 출고지 반품 주소', '출고지 1 · 서울 반품지', '출고지 2']);
    expect(plan.targets.map((target) => adminClaimBulkCollectTargetKey(ID(1), target))).toEqual([`${ID(1)}:${SHIP(71)}`, `${ID(1)}:${SHIP(72)}`, `${ID(1)}:${SHIP(2)}`]);
  });

  it('레거시 회수는 수거중일 때 요청 전체 입고 확인 한 번이다', () => {
    expect(adminClaimBulkCollectPlan(context({ collectionPolicy: 'legacy' })).targets).toEqual([{ shipmentId: null, originName: null }]);
    expect(adminClaimBulkCollectPlan(context({ collectionPolicy: 'legacy', stage: 'collected' })).blocker).toBe('회수 확인이 이미 끝났습니다.');
  });
});

describe('adminClaimBulkRefundTotals', () => {
  it('제외 건과 금액 없는 건을 빼고 결제사별로 합친다', () => {
    expect(adminClaimBulkRefundTotals([
      { claimId: ID(1), reference: 'C00001', providerLabel: '토스 결제', amount: 1000, blocker: null },
      { claimId: ID(2), reference: 'C00002', providerLabel: '토스 결제', amount: 2500, blocker: null },
      { claimId: ID(3), reference: 'C00003', providerLabel: '나이스페이', amount: 700, blocker: null },
      { claimId: ID(4), reference: 'C00004', providerLabel: '무통장 입금', amount: 9000, blocker: '무통장' },
      { claimId: ID(5), reference: 'C00005', providerLabel: '결제 없음', amount: null, blocker: null },
    ])).toEqual({ count: 3, amount: 4200, byProvider: [{ label: '토스 결제', count: 2, amount: 3500 }, { label: '나이스페이', count: 1, amount: 700 }] });
  });
});

describe('단계 일괄 입력', () => {
  const now = new Date('2026-11-12T03:00:00.000Z');
  it('확인창은 목록에 있는 단계와 한도 안의 선택만 연다(재출고 20건)', () => {
    expect(normalizeAdminClaimBulkStepPreviewInput({ claimType: 'return', step: 'collect', claimIds: [ID(1), ID(1).toUpperCase()] }))
      .toEqual({ ok: true, value: { claimType: 'return', step: 'collect', claimIds: [ID(1)] } });
    expect(normalizeAdminClaimBulkStepPreviewInput({ claimType: 'cancel', step: 'reship', claimIds: [ID(1)] }).ok).toBe(false);
    expect(normalizeAdminClaimBulkStepPreviewInput({ claimType: 'exchange', step: 'reship', claimIds: Array.from({ length: 21 }, (_, n) => ID(n)) }))
      .toEqual({ ok: false, error: '한 번에 20건까지 처리할 수 있습니다. 선택을 줄여 다시 실행해주세요.' });
    expect(normalizeAdminClaimBulkStepPreviewInput({ claimType: 'return', step: 'refund', claimIds: Array.from({ length: ADMIN_CLAIM_BULK_LIMIT }, (_, n) => ID(n)) }).ok).toBe(true);
  });

  it('회수 확인 실행은 입고일(오늘까지)·근거(1~500자)·출고지 목록을 받는다', () => {
    const base = { claimType: 'exchange', receivedOn: '2026-11-12', evidence: ' 회신 대조 ', items: [{ claimId: ID(1), shipmentIds: [SHIP(1)] }] };
    expect(normalizeAdminClaimBulkCollectInput(base, now)).toEqual({ ok: true, value: { claimType: 'exchange', receivedOn: '2026-11-12', evidence: '회신 대조', items: [{ claimId: ID(1), shipmentIds: [SHIP(1)], bundleIds: [] }] } });
    expect(normalizeAdminClaimBulkCollectInput({ ...base, receivedOn: '2026-11-13' }, now).ok).toBe(false);
    expect(normalizeAdminClaimBulkCollectInput({ ...base, items: [{ claimId: ID(1), shipmentIds: [], bundleIds: [SHIP(71).toUpperCase()] }] }, now))
      .toMatchObject({ ok: true, value: { items: [{ claimId: ID(1), shipmentIds: [], bundleIds: [SHIP(71)] }] } });
    expect(normalizeAdminClaimBulkCollectInput({ ...base, items: [{ claimId: ID(1), shipmentIds: [], bundleIds: ['seoul'] }] }, now).ok).toBe(false);
    expect(normalizeAdminClaimBulkCollectInput({ ...base, receivedOn: '' }, now).ok).toBe(false);
    expect(normalizeAdminClaimBulkCollectInput({ ...base, evidence: `근거${String.fromCharCode(1)}` }, now).ok).toBe(false);
    expect(normalizeAdminClaimBulkCollectInput({ ...base, items: [{ claimId: ID(1), shipmentIds: [SHIP(1), SHIP(1)] }] }, now).ok).toBe(false);
    expect(normalizeAdminClaimBulkCollectInput({ ...base, items: [{ claimId: ID(1), shipmentIds: [] }, { claimId: ID(1), shipmentIds: [] }] }, now).ok).toBe(false);
  });

  it('환불 실행은 요청마다 확인창에서 본 금액(0 이상 정수)을 받는다', () => {
    expect(normalizeAdminClaimBulkRefundInput({ claimType: 'cancel', items: [{ claimId: ID(1), expectedAmount: 0 }] }))
      .toEqual({ ok: true, value: { claimType: 'cancel', items: [{ claimId: ID(1), expectedAmount: 0 }] } });
    expect(normalizeAdminClaimBulkRefundInput({ claimType: 'return', items: [{ claimId: ID(1), expectedAmount: 1.5 }] }).ok).toBe(false);
    expect(normalizeAdminClaimBulkRefundInput({ claimType: 'return', items: [{ claimId: ID(1) }] }).ok).toBe(false);
    expect(normalizeAdminClaimBulkRefundInput({ claimType: 'exchange', items: [{ claimId: ID(1), expectedAmount: 1 }] }).ok).toBe(false);
  });

  it('재출고 한 줄은 택배사·운송장(영문·숫자 8~30자)·상품을 모두 받아야 보낸다', () => {
    expect(adminClaimBulkReshipRowError({ carrier: 'hanjin', trackingNumber: 'ab12345678', items: [{ variantId: ID(2) }] })).toBeNull();
    expect(adminClaimBulkReshipRowError({ carrier: '', trackingNumber: 'AB12345678', items: [] })).toBe('택배사를 골라주세요.');
    expect(adminClaimBulkReshipRowError({ carrier: 'hanjin', trackingNumber: 'AB-1234', items: [] })).toContain('운송장번호');
    expect(adminClaimBulkReshipRowError({ carrier: 'hanjin', trackingNumber: 'AB12345678', items: [{ variantId: '' }] })).toBe('재출고할 상품을 골라주세요.');
  });
});

describe('확인창 실행 — 미처리 건 이어서 보내기', () => {
  const result = (n: number, outcome: 'done' | 'failed' | 'skipped' | 'excluded') => ({ claimId: ID(n), reference: `C0000${n}`, outcome, message: outcome });

  it('미처리 건만 같은 확인 아래 이어서 보내고, 진행이 없으면 멈춘다', async () => {
    const run = vi.fn()
      .mockResolvedValueOnce({ results: [result(1, 'done'), result(2, 'skipped'), result(3, 'skipped')] })
      .mockResolvedValueOnce({ results: [result(2, 'failed'), result(3, 'skipped')] })
      .mockResolvedValueOnce({ results: [result(3, 'skipped')] });
    const ran = await runClaimBulkInChunks([1, 2, 3].map((n) => ({ claimId: ID(n) })), run);
    expect(run.mock.calls.map(([sent]) => (sent as { claimId: string }[]).map((item) => item.claimId))).toEqual([[ID(1), ID(2), ID(3)], [ID(2), ID(3)], [ID(3)]]);
    expect(ran).toEqual({ results: [result(1, 'done'), result(2, 'failed'), result(3, 'skipped')], error: null });
    expect(adminClaimBulkContinuation([result(1, 'skipped')])).toEqual({ skipped: [result(1, 'skipped')], continue: false });
  });

  it('도중에 오류가 나면 받은 결과까지만 돌려준다(이미 끝난 결제사 취소를 다시 보내지 않는다)', async () => {
    const run = vi.fn().mockResolvedValueOnce({ results: [result(1, 'done'), result(2, 'skipped')] }).mockRejectedValueOnce(new Error('lost'));
    expect(await runClaimBulkInChunks([1, 2].map((n) => ({ claimId: ID(n) })), run))
      .toEqual({ results: [result(1, 'done')], error: '처리 결과를 받지 못했습니다. 목록을 새로고침해 각 건의 상태를 확인하세요.' });
  });

  it('결과를 고른 순서로 맞추고 확인창에서 뺀 건을 제외로 채운다', () => {
    expect(mergeClaimBulkResults([ID(1), ID(2), ID(3)], [{ claimId: ID(2), reference: 'C00002', message: '무통장' }], [result(3, 'done'), result(1, 'failed')])).toEqual({
      summary: '처리됨 1건 · 실패 1건 · 건너뜀 1건',
      results: [result(1, 'failed'), { claimId: ID(2), reference: 'C00002', outcome: 'excluded', message: '무통장' }, result(3, 'done')],
    });
  });
});
