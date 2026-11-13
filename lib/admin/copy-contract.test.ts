import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * 어드민 문구 계약(ADM-016 D·E, 2026-11-13). 화면마다 달랐던 말을 하나로 맞춘 결정이 다시 갈라지지 않게 고정한다.
 * 주석과 지난 주 업데이트 내역(lib/admin/guide/changes.ts, 그때 동작의 기록)은 보지 않는다.
 * 엑셀 양식의 열 이름은 외부 파일 계약(스마트스토어·창고 양식)이라 아래 예외에 이유와 함께 둔다.
 */
const ROOT = join(__dirname, '..', '..');
const DIRS = ['components/admin', 'app/admin', 'lib/admin'];
const SKIP_FILE = /(\.test\.|\.fixture\.|\.d\.ts$)|lib\/admin\/guide\/changes\.ts$/;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'node_modules' ? [] : files(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

function code(path: string) {
  return readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
}

const SOURCES = DIRS.flatMap((dir) => files(join(ROOT, dir)))
  .map((path) => relative(ROOT, path))
  .filter((path) => !SKIP_FILE.test(path))
  .map((path) => ({ path, text: code(join(ROOT, path)) }));

function offenders(pattern: RegExp, allowed: readonly string[] = []) {
  return SOURCES.filter((source) => pattern.test(source.text) && !allowed.includes(source.path)).map((source) => source.path);
}

/** 스마트스토어·창고(서원·김포) 파일이 쓰는 열 이름이다. 파일 양식은 우리가 바꿀 수 없다. */
const EXCEL_FORMAT_FILES = [
  'lib/admin/warehouse-templates.ts',
  'lib/admin/smartstore-shipment-workbook.ts',
  'lib/admin/smartstore-shipment-workbook.server.ts',
  'lib/admin/smartstore-delivery-list.ts',
  'lib/admin/shipment-workbook.ts',
  'lib/admin/list-export-sheets.ts',
  'lib/admin/order-items-export.ts',
];

describe('어드민 문구 계약 (ADM-016 E)', () => {
  it('#18 받는 사람은 수령인이다(수취인은 엑셀 양식 열 이름에만 남는다)', () => {
    expect(offenders(/수취인/, EXCEL_FORMAT_FILES)).toEqual([]);
  });

  it('#19 답을 못 한 문의는 미답변 문의다', () => {
    expect(offenders(/미응답 문의/)).toEqual([]);
  });

  it('#25 시각은 KST로 쓴다(한국 시간·한국 시각·한국시간을 섞지 않는다)', () => {
    expect(offenders(/한국 ?시(?:간|각)/)).toEqual([]);
  });

  it('#26 운송장·배송비를 쓴다(송장·운임은 창고 양식 이름과 열 이름에만 남는다)', () => {
    const waybill = /(?<![운])송장(?!양식|번호)/;
    expect(offenders(waybill, ['lib/admin/warehouse-templates.ts', 'lib/admin/warehouse-templates.server.ts', 'lib/admin/navigation.ts'])).toEqual([]);
    expect(offenders(/운임(?!Type)/)).toEqual([]);
  });

  it('#27 도움말 화면의 이름은 사용 가이드다', () => {
    expect(offenders(/판매자 가이드|판매자센터 운영 가이드/)).toEqual([]);
  });

  it('#20 상품 게시 상태는 초안·공개·보관이다(목록 상태 이름에 임시저장·전시중을 쓰지 않는다)', () => {
    for (const path of ['components/admin/screens/GoodsListScreen.tsx', 'components/admin/screens/GoodsListFiltersForm.tsx', 'components/admin/GoodsBulkToolbar.tsx']) {
      const text = SOURCES.find((source) => source.path === path)?.text ?? '';
      expect(text, path).not.toMatch(/'임시저장'|'전시중'/);
    }
  });

  it('#21 행 작업 이름은 상세·수정·처리다', () => {
    expect(offenders(/(?<!모델 )상세 보기|상세·처리|상세 관리|고객 상세 열기|답변처리|답변 확인 · 수정/)).toEqual([]);
  });

  it('#38 홈 전시 이동 화면에 옛 이름 IP 허브를 쓰지 않는다', () => {
    expect(offenders(/IP 허브/)).toEqual([]);
  });

  it('최고 관리자 전용 거절 문구에 코드 값(admin)을 드러내지 않는다', () => {
    expect(offenders(/관리자\(admin\)/)).toEqual([]);
  });
});
