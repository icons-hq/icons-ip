import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * 고객 화면 확인창 계약(원장 재작업 후속 4의 나머지).
 * 고객 표면은 브라우저 기본 confirm() 대신 고객 공용 확인창(lib/customer-confirm.ts)을 쓴다. 기본 대화상자는 동기라 화면 언어·접근성·시험이
 * 막히고, 모바일 인앱 브라우저에서는 막히거나 문구가 잘린다. 어드민은 별도 adminConfirm 체계(lib/admin/confirm.ts)라 대상이 아니다.
 * 선물 화면 4곳은 components/gifts/useGiftUnsaved.test.ts가 같은 방식으로 고정한다.
 */
const root = process.cwd();
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');

const MIGRATED = [
  'components/orders/ClaimRefundAccount.tsx',
  'components/screens/ReviewDeleteButton.tsx',
  'components/screens/subscriptions/SubscriptionDetail.tsx',
  'components/subscriptions/SubscriptionCards.tsx',
  'components/subscriptions/useSubscriptionRequest.ts',
];

/* 전역 객체를 거친 호출은 언제나 기본 대화상자다. 맨 이름 호출은 그 파일이 같은 이름을 직접 선언하지 않았을 때만 기본 대화상자로 본다. */
const GLOBAL_CALL = /\b(?:window|globalThis|self)\s*\.\s*confirm\b/;
const BARE_CALL = /(^|[^A-Za-z0-9_$.])confirm\s*\(/m;
const LOCAL_BINDING = /\b(?:function|const|let|var)\s+confirm\b|[({,]\s*confirm\s*[:,)}=?]/;
const callsNativeConfirm = (source: string) => GLOBAL_CALL.test(source) || BARE_CALL.test(source) && !LOCAL_BINDING.test(source);

/** 어드민 밖의 'use client' 모듈(시험 파일 제외). */
function customerClientModules(): string[] {
  const found: string[] = [];
  const walk = (directory: string) => {
    for (const entry of readdirSync(path.join(root, directory), { withFileTypes: true })) {
      const file = path.posix.join(directory, entry.name);
      if (entry.isDirectory()) { if (entry.name !== 'node_modules' && entry.name !== 'admin') walk(file); continue; }
      if (!/\.tsx?$/.test(entry.name) || /\.(test|spec|test-support)\.tsx?$/.test(entry.name)) continue;
      if (/^\s*(['"])use client\1/.test(read(file))) found.push(file);
    }
  };
  for (const directory of ['app', 'components', 'lib']) walk(directory);
  return found;
}

describe('고객 화면 확인창 계약', () => {
  it('환불계좌 이탈 경고·리뷰 삭제·정기구매 해지와 일시정지·정기결제 카드 삭제·정기구매 이탈 경고는 고객 공용 확인창을 쓴다', () => {
    for (const file of MIGRATED) {
      const source = read(file);
      expect(source, file).not.toMatch(/(^|[^A-Za-z_.])confirm\(|window\.confirm/);
      expect(source, file).toContain('customerConfirm(');
    }
  });
  it('어드민 밖 클라이언트 모듈은 브라우저 기본 confirm을 부르지 않는다', () => {
    const modules = customerClientModules();
    expect(modules).toEqual(expect.arrayContaining(MIGRATED));
    expect(modules.filter((file) => callsNativeConfirm(read(file)))).toEqual([]);
  });
  it('판정식은 기본 confirm 호출과 같은 이름의 지역 함수를 가른다', () => {
    expect(callsNativeConfirm("if (!window.confirm('삭제할까요?')) return;")).toBe(true);
    expect(callsNativeConfirm("if (!confirm('삭제할까요?')) return;")).toBe(true);
    expect(callsNativeConfirm("void customerConfirm({ title: '삭제할까요?', confirmLabel: '삭제' });")).toBe(false);
    expect(callsNativeConfirm('async function confirm() { await save(); }\nonClick={() => void confirm()}')).toBe(false);
    expect(callsNativeConfirm('await gateway.confirm(input);')).toBe(false);
  });
});
