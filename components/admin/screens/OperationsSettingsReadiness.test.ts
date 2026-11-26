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
    regions: [{ kind: 'unused' }],
    carriers: [{ active: true }, { active: false }],
    activeNoticeTemplates: 2,
    storeCreditsEnabled: true,
  });
  expect(state.business).toEqual({ done: false, detail: '1개 항목 미입력' });
  expect(state.bankTransfer).toEqual({ done: false, detail: '계좌 미입력' });
  expect(state.origins).toEqual({ done: false, detail: '반품 주소 1곳 미입력' });
  expect(state.regions).toEqual({ done: false, detail: '적용 중인 설정 없음' });
  expect(state.carriers).toEqual({ done: true, detail: '1곳 사용 중' });
  expect(state.notices).toEqual({ done: true, detail: '사용 중인 템플릿 2개' });
  expect(state.storeCredits).toEqual({ done: true, detail: '정책 사용 중' });
});

it('무통장 계좌는 세 항목이 모두 있어야 완료다', () => {
  expect(operationsReadiness({ bankTransfer: { bank: '은행', accountNumber: '1', holder: '' } }).bankTransfer?.done).toBe(false);
  expect(operationsReadiness({ bankTransfer: { bank: '은행', accountNumber: '1', holder: '예금주' } }).bankTransfer?.done).toBe(true);
});

it('지역별 추가배송비 카드는 적용 중인 설정이 있어야 완료이고, 새 주문이 막힌 출고지가 하나라도 있으면 완료가 아니다', () => {
  const regions = (...kinds: ('unused' | 'upcoming' | 'in_effect' | 'blocked')[]) => operationsReadiness({ regions: kinds.map(kind => ({ kind })) }).regions;
  expect(regions('in_effect', 'in_effect')).toEqual({ done: true, detail: '적용 중인 설정 2개' });
  /* 쓰지 않는 출고지가 섞여 있어도 막힌 곳이 없으면 적용 중인 설정으로 말한다. */
  expect(regions('in_effect', 'unused')).toEqual({ done: true, detail: '적용 중인 설정 1개' });
  /* 끝났거나 끝낸 설정·시작 전인 설정만 있으면 적용 중인 설정이 없다 — 예전처럼 '사용 중인 정책'으로 세지 않는다. */
  expect(regions('upcoming')).toEqual({ done: false, detail: '적용 중인 설정 없음' });
  expect(regions()).toEqual({ done: false, detail: '적용 중인 설정 없음' });
  expect(regions('in_effect', 'blocked', 'blocked')).toEqual({ done: false, detail: '새 주문이 막힌 출고지 2곳' });
});
