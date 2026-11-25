import { describe, expect, it } from 'vitest';
import { GOOD_FIELDS_B_HELP } from './good-fields-b';
import { ADMIN_HELP_PARTS, type AdminHelp } from './types';

/*
 * 이 문구 묶음은 아직 index에 등록되지 않아 help-contract.test.ts가 보지 못한다. 같은 형식·표현 규칙을 여기서 먼저 지킨다
 * (등록한 뒤에는 help-contract.test.ts가 같은 것을 본다).
 */
const BANNED = [
  /선행 0|반입|미설정|스냅샷|멱등|레코드|세션|감사 로그|판매자상품코드|관리코드|한국 시간|한국 시각/,
  /정합(?!니)|매핑|(?<!이)상한(?!다)|하한(?!다)|경합|식별자|프리셋|활성화|비활성화|페이로드|파라미터|토큰|캐시|동기화|유효하지 않은/,
  /\b(RPC|DB|UUID|ID|API|JSON|SKU)\b/i,
  /확장 배송비|저장 버전|리비전|revision/i,
  /해요|하세요|됩니다요|돼요|이에요|예요/,
  /에 대한|을 통해|를 통해|에 의해|것이 가능|되어집니다|되어지|해당 |상기 |의 경우[ ,]|에 한하여/,
];
const texts = (help: AdminHelp) => [help.what, ...ADMIN_HELP_PARTS.map(([part]) => help[part]).filter((value): value is string => typeof value === 'string')];

describe('GOOD_FIELDS_B_HELP 문구', () => {
  const entries = Object.entries(GOOD_FIELDS_B_HELP).map(([key, help]) => ({ key, help: help as AdminHelp }));

  it('모든 문장은 마침표로 끝나고, 한 줄 110자·한 건 260자 안이다', () => {
    for (const { key, help } of entries) {
      for (const text of texts(help)) {
        expect(text, key).toMatch(/[.]$/);
        expect(text.length, `${key}: ${text}`).toBeLessThanOrEqual(110);
      }
      expect(texts(help).join('').length, key).toBeLessThanOrEqual(260);
    }
  });

  it('쓰지 않는 표현·개발 용어·내부 값 이름이 없다', () => {
    const hits = entries.flatMap(({ key, help }) => texts(help).flatMap((text) => BANNED.filter((pattern) => pattern.test(text)).map((pattern) => `${key}: ${text.match(pattern)?.[0]}`)));
    expect(hits).toEqual([]);
  });
});
