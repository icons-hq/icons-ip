import { expect, it } from 'vitest';
import * as copy from './claim-change-copy';
import { SAVE_CHECK_LABEL, SAVE_UNKNOWN_MESSAGE } from './goods-template-save';

/* 보류·유형 전환·사유 정정 창이 함께 쓰는 말. 문장 속 버튼 이름은 화면에 적힌 그대로여야 한다(docs/admin-copy-guide.md 원칙 6). */
it('결과를 모를 때의 말은 템플릿 화면과 같은 상수를 쓴다', () => {
  expect(copy.CLAIM_CHANGE_CHECK_LABEL).toBe(SAVE_CHECK_LABEL);
  expect(copy.CLAIM_CHANGE_UNKNOWN_MESSAGE).toBe(SAVE_UNKNOWN_MESSAGE);
  expect(copy.CLAIM_CHANGE_UNKNOWN_MESSAGE).toContain(`[${copy.CLAIM_CHANGE_CHECK_LABEL}]`);
});

it('문장이 가리키는 버튼 이름은 버튼의 이름과 같다', () => {
  expect(copy.CLAIM_CHANGE_CONFLICT_MESSAGE).toContain('다른 사람이 먼저 바꿨습니다.');
  expect(copy.CLAIM_CHANGE_CONFLICT_MESSAGE).toContain(`[${copy.CLAIM_CHANGE_RELOAD_LABEL}]`);
  expect(copy.CLAIM_CHANGE_NOT_SAVED_MESSAGE).toContain(`[${copy.CLAIM_CHANGE_RESEND_LABEL}]`);
  expect(copy.CLAIM_CHANGE_NOT_SAVED_MESSAGE).toContain('같은 내용이 두 번 저장되지 않습니다.');
  expect(copy.CLAIM_CHANGE_RECEIPT_MISMATCH_MESSAGE).toContain(`[${copy.CLAIM_CHANGE_CHECK_LABEL}]`);
  expect(copy.CLAIM_CHANGE_RECEIPT_READ_FAILED_MESSAGE).toContain(`[${copy.CLAIM_CHANGE_CHECK_LABEL}]`);
  expect([copy.CLAIM_CHANGE_CHECK_LABEL, copy.CLAIM_CHANGE_RESEND_LABEL, copy.CLAIM_CHANGE_RELOAD_LABEL, copy.CLAIM_CHANGE_BACK_LABEL])
    .toEqual(['저장됐는지 확인', '같은 내용으로 다시 저장', '최신 상태 불러오기', '돌아가기']);
});

it('낱말 표가 쓰지 않는 말을 쓰지 않는다(같은 요청 결과 확인·재시도·경합·충돌·확정)', () => {
  const strings = (Object.values(copy) as unknown[]).filter((value): value is string => typeof value === 'string');
  expect(strings.length).toBeGreaterThan(10);
  for (const text of strings) expect(text).not.toMatch(/같은 요청|요청 결과|재시도|경합|충돌|버전|확정|해당|확인했습니다/);
});

it('글자 수 안내는 범위와 지금 글자 수를 말한다', () => {
  expect(copy.claimChangeCount(12, 10, 200)).toBe('10~200자 · 지금 12자');
  expect(copy.claimChangeCount(0, 1, 200)).toBe('1~200자 · 지금 0자');
});
