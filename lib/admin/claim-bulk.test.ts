import { describe, expect, it, vi } from 'vitest';
import {
  ADMIN_CLAIM_BULK_DB_ITEM_RESERVE_MS,
  ADMIN_CLAIM_BULK_DEADLINE_MS,
  ADMIN_CLAIM_BULK_LIMIT,
  ADMIN_CLAIM_BULK_PROVIDER_ITEM_RESERVE_MS,
  ADMIN_CLAIM_BULK_TIME_BUDGET_MS,
  adminClaimBulkConfirmation,
  adminClaimBulkSelectable,
  adminClaimBulkSummary,
  adminClaimBulkTimeoutMessage,
  normalizeAdminClaimBulkForm,
  planAdminClaimBulkSubmit,
  runAdminClaimBulkSequentially,
} from './claim-bulk';

const ID = (n: number) => `abcdef${String(n).padStart(2, '0')}-1234-4123-8123-123456789abc`;

function form(entries: [string, string][]) {
  const data = new FormData();
  for (const [key, value] of entries) data.append(key, value);
  return data;
}

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
  it('미처리 건수를 확정 문구로 알린다', () => {
    expect(adminClaimBulkTimeoutMessage(3)).toBe('처리 시간이 길어 3건은 처리하지 않았습니다. 다시 실행하세요.');
    expect(adminClaimBulkSummary(['done', 'failed', 'skipped', 'skipped'])).toBe(
      '처리됨 1건 · 실패 1건 · 처리 시간이 길어 2건은 처리하지 않았습니다. 다시 실행하세요.',
    );
    expect(adminClaimBulkSummary(['done', 'done'])).toBe('처리됨 2건 · 실패 0건');
  });

  it('취소 일괄 승인은 토스 전액 취소가 건마다 나간다고 확인한다', () => {
    expect(adminClaimBulkConfirmation('cancel', 'approve', 3)).toContain('토스 전액 취소');
    expect(adminClaimBulkConfirmation('return', 'approve', 2)).toBe('선택한 2건을 승인하고 수거를 시작할까요?');
    expect(adminClaimBulkConfirmation('exchange', 'reject', 4)).toContain('구매자에게 전달');
  });
});

describe('adminClaimBulkSelectable', () => {
  it('승인·거부·검토중이 가능한 단계만 고를 수 있다', () => {
    expect(adminClaimBulkSelectable('cancel', 'requested')).toBe(true);
    expect(adminClaimBulkSelectable('cancel', 'in_review')).toBe(true);
    expect(adminClaimBulkSelectable('cancel', 'on_hold')).toBe(true);
    expect(adminClaimBulkSelectable('cancel', 'processing')).toBe(false);
    expect(adminClaimBulkSelectable('cancel', 'needs_review')).toBe(false);
    expect(adminClaimBulkSelectable('return', 'collecting')).toBe(true);
    expect(adminClaimBulkSelectable('exchange', 'collected')).toBe(true);
    expect(adminClaimBulkSelectable('return', 'completed')).toBe(false);
    expect(adminClaimBulkSelectable('return', 'withdrawn')).toBe(false);
  });
});

describe('planAdminClaimBulkSubmit', () => {
  const allow = () => true;
  it('선택·작업·거부 사유를 서버에 보내기 전에 확인한다', () => {
    expect(planAdminClaimBulkSubmit({ claimType: 'cancel', count: 0, decision: 'review', note: '' }, allow)).toEqual({ kind: 'invalid', error: '처리할 요청을 선택해주세요.' });
    expect(planAdminClaimBulkSubmit({ claimType: 'cancel', count: 51, decision: 'review', note: '' }, allow)).toMatchObject({ kind: 'invalid' });
    expect(planAdminClaimBulkSubmit({ claimType: 'cancel', count: 1, decision: null, note: '' }, allow)).toEqual({ kind: 'invalid', error: '처리할 작업을 선택해주세요.' });
    expect(planAdminClaimBulkSubmit({ claimType: 'cancel', count: 2, decision: 'reject', note: ' 짧다 ' }, allow)).toEqual({ kind: 'invalid', error: '거부 사유를 10자 이상 200자 이하로 입력해주세요.' });
  });

  it('누른 작업의 확인 문구로 묻고, 취소하면 보내지 않는다', () => {
    const asked: string[] = [];
    const deny = (message: string) => { asked.push(message); return false; };
    expect(planAdminClaimBulkSubmit({ claimType: 'cancel', count: 3, decision: 'approve', note: '' }, deny)).toEqual({ kind: 'dismissed' });
    expect(asked[0]).toBe(adminClaimBulkConfirmation('cancel', 'approve', 3));
    expect(planAdminClaimBulkSubmit({ claimType: 'return', count: 2, decision: 'reject', note: '반품 가능 기간이 지났습니다.' }, allow)).toEqual({ kind: 'submit', decision: 'reject' });
  });
});
