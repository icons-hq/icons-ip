import { readFileSync, readdirSync, statSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/*
 * 서비스 이름 계약(2026-11-24, CONTEXT.md '엑스스퀘어(X SQUARE)') — 고객·운영자에게 보이는 문구는 옛 서비스 이름 'ICONS'를 쓰지 않는다.
 * 한국어 문장은 '엑스스퀘어', 로고·영문 표식은 'X SQUARE'다. 코드 식별자(ICONS_*, X-ICONS-* 머리글)는 문구가 아니라 검사하지 않고,
 * 아래 예외는 바꾸면 호환이 깨지거나 개정 절차가 필요한 값이라 이유와 함께 남긴다.
 */
const EXCEPTIONS = [
  ...['lib/admin/goods-workbook.ts', 'lib/admin/goods-workbook-file.ts', 'lib/admin/goods-custom-input-workbook-file.ts', 'lib/admin/goods-guidance-workbook-file.ts']
    .map(file => ({ file, text: 'ICONS 상품 일괄 등록', reason: '상품 일괄 등록 엑셀의 버전 표시다. 올린 파일의 양식을 이 값으로 알아보므로 바꾸면 전에 내려받은 파일을 올릴 수 없다.' })),
  { file: 'lib/admin/warehouse-templates.server.ts', text: '/ICONS/', reason: '김포 창고 WMS 양식의 받는 쇼핑몰 표기다. 창고 시스템이 이 값으로 주문 출처를 가르므로 창고와 합의 없이 바꾸지 않는다.' },
  { file: 'lib/payments/toss-config.mjs', text: 'ICONS', reason: '토스 결제 어드민에 만든 결제 UI(variant) 키다. 결제 어드민의 등록값과 같아야 위젯이 그려지고 결제가 ICONS 전용 MID로 잡힌다.' },
  { file: 'components/shell/StoreBranding.tsx', text: 'ICONS', reason: '통일 전 기본 스토어 이름이 남은 저장값을 기본 로고로 보이게 하는 비교값이다. 화면에 글자로 나오지 않는다.' },
  { file: 'lib/legal/documents.ts', text: 'ICONS', reason: '이용약관 제1조는 7일 사전 공지 뒤 시행하는 예약 개정(brand-name-revision)으로 바뀐다. 시행 전 현행 본문·개정 앵커와 개정 안내 문장이다.' },
  { file: 'lib/admin/guide/changes.ts', text: 'ICONS', reason: '운영자에게 서비스 이름이 ICONS에서 엑스스퀘어로 바뀌었다고 알리는 변경 기록 문장이라 옛 이름을 그대로 인용한다.' },
  { file: 'lib/data.ts', text: 'ICONS', reason: '로컬 mock 카탈로그다. seed.sql·초기 migration과 같은 시연 값을 쓰며 운영 DB와 화면(Supabase 모드)에는 나오지 않는다.' },
] as const;

const SOURCES = ['app', 'components', 'lib'];
const OLD_NAME = /(^|[^A-Za-z0-9_-])ICONS(?![A-Za-z0-9_-])/;
/* 전수 검사는 범위 안 모든 TS/TSX/JS/JSX 를 파싱해 CI 러너에서 기본 5초를 넘길 수 있다(vocabulary-contract.test.ts와 같은 이유). */
const FULL_SCAN_TIMEOUT_MS = 20_000;

function sourceFiles(path: string): string[] {
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? sourceFiles(`${path}/${entry.name}`)
    : /\.(?:ts|tsx|js|jsx|mjs)$/.test(entry.name) && !/\.test\.|\.live\./.test(entry.name) ? [`${path}/${entry.name}`] : []);
}
function literals(file: string) {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const result: { file: string; line: number; text: string }[] = [];
  function visit(node: ts.Node) {
    if (ts.isStringLiteralLike(node) || ts.isJsxText(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      result.push({ file, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, text: node.text.replace(/\s+/g, ' ').trim() });
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return result;
}

describe('서비스 이름 계약 — 엑스스퀘어', () => {
  it('화면·메일·문자·결제 문구에 옛 서비스 이름 ICONS를 쓰지 않는다', () => {
    const violations = SOURCES.flatMap(sourceFiles).flatMap(literals)
      .filter(copy => OLD_NAME.test(copy.text))
      .filter(copy => !EXCEPTIONS.some(exception => exception.file === copy.file && copy.text.includes(exception.text)));
    expect(violations).toEqual([]);
  }, FULL_SCAN_TIMEOUT_MS);

  it('예외는 실제로 쓰이는 값만 남기고 구체적인 이유를 적는다', () => {
    for (const exception of EXCEPTIONS) {
      expect(exception.reason.length, exception.file).toBeGreaterThan(20);
      expect(literals(exception.file).some(copy => copy.text.includes(exception.text)), `${exception.file}: ${exception.text}`).toBe(true);
    }
  });
});
