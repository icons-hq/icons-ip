import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ADMIN_HELP_BOOKS } from './index';
import { ADMIN_HELP_PARTS, type AdminHelp } from './types';

/*
 * "?" 도움말 문구 검사(docs/admin-screen-rules.md 규칙 3, docs/admin-copy-guide.md 용어 대체표).
 * 도움말은 처음 보는 운영자가 읽는다 — 짧은 문장, '~합니다'체, 개발 용어 없음.
 */
const BANNED: readonly [RegExp, string][] = [
  [/선행 0|반입|미설정|스냅샷|멱등|레코드|세션|감사 로그|판매자상품코드|관리코드|한국 시간|한국 시각/, '용어 대체표의 쓰지 않는 표현'],
  /* '정합니다'·'이상한'·'~하한다'처럼 다른 낱말의 일부인 경우는 잡지 않는다. */
  [/정합(?!니)|매핑|(?<!이)상한(?!다)|하한(?!다)|경합|식별자|프리셋|활성화|비활성화|페이로드|파라미터|토큰|캐시|동기화|유효하지 않은/, '용어 대체표의 쓰지 않는 표현'],
  [/\b(RPC|DB|UUID|ID|API|JSON|SKU)\b/i, '개발 용어'],
  [/확장 배송비|저장 버전|리비전|revision/i, '내부 값 이름(규칙 8)'],
  [/해요|하세요|됩니다요|돼요|이에요|예요/, "'~합니다'체가 아닌 말투"],
  [/에 대한|을 통해|를 통해|에 의해|것이 가능|되어집니다|되어지|해당 |상기 |의 경우[ ,]|에 한하여/, '번역투(admin-copy-guide 원칙 10)'],
];
const entries = Object.entries(ADMIN_HELP_BOOKS).flatMap(([book, helps]) => Object.entries(helps).map(([key, help]) => ({ name: `${book}.${key}`, help: help as AdminHelp })));
const texts = (help: AdminHelp) => [help.what, ...ADMIN_HELP_PARTS.map(([part]) => help[part]).filter((value): value is string => typeof value === 'string')];

describe('어드민 "?" 도움말 문구', () => {
  it('도움말 묶음 파일은 모두 index에 등록한다', () => {
    const files = readdirSync(__dirname).filter((name) => /\.ts$/.test(name) && !/^(index|types)\.ts$/.test(name) && !/\.test\.ts$/.test(name)).map((name) => name.replace(/\.ts$/, ''));
    expect(Object.keys(ADMIN_HELP_BOOKS).sort()).toEqual(files.sort());
  });

  it('무엇인지(what)는 꼭 있고, 모든 문장은 마침표로 끝난다', () => {
    const problems = entries.flatMap(({ name, help }) => texts(help).filter((text) => !text.trim() || text !== text.trim() || !/[.]$/.test(text) || /\n/.test(text)).map((text) => `${name}: ${text}`));
    expect(problems).toEqual([]);
  });

  it('한 줄은 110자, 한 건은 모두 합쳐 260자를 넘지 않는다(도움말은 한두 문장이 기본)', () => {
    const problems = entries.flatMap(({ name, help }) => [
      ...texts(help).filter((text) => text.length > 110).map((text) => `${name}: ${text.length}자 — ${text.slice(0, 30)}…`),
      ...(texts(help).join('').length > 260 ? [`${name}: 합계 ${texts(help).join('').length}자`] : []),
    ]);
    expect(problems).toEqual([]);
  });

  it('쓰지 않는 표현·개발 용어·내부 값 이름이 없다', () => {
    const problems = entries.flatMap(({ name, help }) => texts(help).flatMap((text) => BANNED.filter(([pattern]) => pattern.test(text)).map(([pattern, why]) => `${name}: ${why} — ${text.match(pattern)?.[0]}`)));
    expect(problems).toEqual([]);
  });
});
