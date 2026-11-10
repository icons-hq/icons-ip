import { expect, it } from 'vitest';
import { operationsReadiness } from './OperationsSettingsReadiness';

it('읽지 못한 값은 미입력으로 단정하지 않고 상태를 비워 둔다', () => {
  expect(operationsReadiness({})).toEqual({});
});

it('저장값으로 카드별 완료·미완료를 말한다', () => {
  const state = operationsReadiness({
    business: { hostingProvider: '' },
    bankTransfer: null,
    origins: [{ active: true, returnAddress: '' }, { active: false, returnAddress: '' }],
    regions: [{ status: 'draft' }],
    carriers: [{ active: true }, { active: false }],
    activeNoticeTemplates: 2,
    storeCreditsEnabled: true,
  });
  expect(state.business).toEqual({ done: false, detail: '1개 항목 미입력' });
  expect(state.bankTransfer).toEqual({ done: false, detail: '계좌 미입력' });
  expect(state.origins).toEqual({ done: false, detail: '반품 주소 1곳 미입력' });
  expect(state.regions).toEqual({ done: false, detail: '활성 정책 없음' });
  expect(state.carriers).toEqual({ done: true, detail: '1곳 사용 중' });
  expect(state.notices).toEqual({ done: true, detail: '활성 템플릿 2개' });
  expect(state.storeCredits).toEqual({ done: true, detail: '정책 사용 중' });
});

it('무통장 계좌는 세 항목이 모두 있어야 완료다', () => {
  expect(operationsReadiness({ bankTransfer: { bank: '은행', accountNumber: '1', holder: '' } }).bankTransfer?.done).toBe(false);
  expect(operationsReadiness({ bankTransfer: { bank: '은행', accountNumber: '1', holder: '예금주' } }).bankTransfer?.done).toBe(true);
});
