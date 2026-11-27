import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * 어드민 화면 규칙 전환 현황(docs/admin-screen-rules.md, 2026-11-25). 읽는 방식은 lib/admin/copy-contract.test.ts와 같다 — 주석은 보지 않는다.
 *
 * 규칙 1: 대상을 고르는 칸은 모두 공용 선택창(AdminPickerDialog·AdminGoodsPicker)을 쓴다. 아직 옮기지 않은 화면은 아래 허용 목록에 있다.
 *   허용 목록은 줄어들기만 한다 — 새 화면이 옛 방식(자체 선택창)을 쓰면 실패하고, 옮긴 화면은 목록에서 지우지 않으면 실패한다.
 *   '자체 선택창'은 (a) CustomerServiceDialog와 ConsolePagination을 함께 import하거나, (b) 검색칸(type="search")과 ConsolePagination을 함께 가진 파일이다.
 *   (b)는 검색칸과 페이지가 있는 목록·관리 화면도 잡는다. 그런 화면은 선택창이 아니지만, 주석에 '목록 화면'이라 적어 목록에 둔다.
 * 규칙 8: 내부 값(저장 버전 같은)은 화면에 보이지 않는다. 옛 이름 '확장 배송비'도 다시 쓰지 않는다.
 */
const ROOT = join(__dirname, '..', '..');
const SKIP_FILE = /(\.test\.|\.fixture\.|\.d\.ts$)|lib\/admin\/guide\/changes\.ts$/;
const SHARED_PICKER = 'components/admin/console/AdminPickerDialog.tsx';

/** 아직 공용 선택창으로 옮기지 않은 화면. 옮겼으면 그 줄을 지운다(줄어들기만 한다). 줄 끝은 어느 화면인지다. */
const LEGACY_PICKERS: readonly string[] = [
  'components/admin/CategoryDisplayGoodsPicker.tsx', // 카테고리 전시·캠페인·할인 프로모션의 상품 고르기
  'components/admin/CategoryErpMappingTable.tsx', // 카테고리 관리의 카테고리별 ERP 코드 표(목록 화면)
  'components/admin/CouponCategoryPicker.tsx', // 쿠폰 대상 카테고리 고르기
  'components/admin/CouponIpPicker.tsx', // 쿠폰 대상 IP 고르기
  'components/admin/CouponTargetingFields.tsx', // 쿠폰 대상 상품 고르기
  'components/admin/GoodsGroupOperation.tsx', // 그룹상품·일괄 변경의 상품 표(검색)
  'components/admin/ShoppingStoryGoodsPicker.tsx', // 쇼핑스토리 관련상품 찾기
  'components/admin/screens/BenefitReportScreen.tsx', // 혜택 리포트(목록 화면)
  'components/admin/screens/CategoryTemplatesScreen.tsx', // 자주 쓰는 카테고리 관리(목록 화면)
  'components/admin/screens/CsReplyTemplateTools.tsx', // 상담 답변 템플릿 고르기
  'components/admin/screens/ErpItemsScreen.tsx', // ERP 품목(목록 화면)
  'components/admin/screens/GoodsAfterSalesTemplatesScreen.tsx', // A/S 템플릿 관리(목록 화면)
  'components/admin/screens/GoodsEventTemplatesScreen.tsx', // 이벤트 템플릿 관리(목록 화면)
  'components/admin/screens/GoodsNoticePresetsScreen.tsx', // 상품정보제공고시 템플릿 관리(목록 화면)
  'components/admin/screens/GoodsPhotoLibraryScreen.tsx', // 사진 보관함(목록 화면)
  'components/admin/screens/GoodsSizeTemplatesScreen.tsx', // 사이즈 템플릿 관리(목록 화면)
  'components/admin/screens/InquiryChatScreen.tsx', // 문의 상담 화면(목록 검색)
  'components/admin/screens/InquiryReplyTemplateTools.tsx', // 고객문의 답변 템플릿 고르기
  'components/admin/screens/OperatorDirectoryScreen.tsx', // 운영자 목록(목록 화면)
  'components/admin/screens/OperatorInvitationConsole.tsx', // 운영자 초대 목록(목록 화면)
  'components/admin/screens/PgSettlementScreen.tsx', // PG 정산 대조(목록 화면)
  'components/admin/screens/ReviewEventTemplatesScreen.tsx', // 리뷰이벤트 문구 템플릿 관리·고르기
  'components/admin/screens/ShippingNoticeTemplatesScreen.tsx', // 배송 안내 템플릿 관리(목록 화면)
  'components/admin/screens/ShippingSettingsTemplatesScreen.tsx', // 배송정보 템플릿 관리(목록 화면)
  'components/admin/screens/ShoppingStoriesScreen.tsx', // 쇼핑스토리 목록
];

function files(dir: string, extension: RegExp): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'node_modules' ? [] : files(path, extension);
    return extension.test(name) ? [path] : [];
  });
}

/** 주석을 뺀 코드(copy-contract.test.ts와 같다). */
function code(path: string) {
  return readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
}

const imports = (text: string, name: string) => new RegExp(`import[^;]*\\b${name}\\b[^;]*from\\s*['"]`).test(text);

/** 지금 자체 선택창으로 판정되는 파일(정렬). */
function ownPickers(): string[] {
  return files(join(ROOT, 'components/admin'), /\.tsx$/)
    .map((path) => relative(ROOT, path))
    .filter((path) => !SKIP_FILE.test(path) && path !== SHARED_PICKER)
    .filter((path) => {
      const text = code(join(ROOT, path));
      const dialogWithPages = imports(text, 'CustomerServiceDialog') && imports(text, 'ConsolePagination');
      const searchWithPages = /type="search"/.test(text) && /\bConsolePagination\b/.test(text);
      return dialogWithPages || searchWithPages;
    })
    .sort();
}

describe('어드민 화면 규칙 전환 현황 (docs/admin-screen-rules.md)', () => {
  it('규칙 1: 자체 선택창을 쓰는 화면은 허용 목록에 있는 화면뿐이다', () => {
    const added = ownPickers().filter((path) => !LEGACY_PICKERS.includes(path));
    expect(added, `새 화면은 공용 선택창 AdminPickerDialog·AdminGoodsPicker를 써 주세요(docs/admin-screen-rules.md 규칙 1). 걸린 파일: ${added.join(', ')}`).toEqual([]);
  });

  it('규칙 1: 허용 목록의 화면은 아직 자체 선택창이다 — 옮겼으면 목록에서 지운다(목록은 줄어들기만 한다)', () => {
    const current = new Set(ownPickers());
    const converted = LEGACY_PICKERS.filter((path) => !current.has(path));
    expect(converted, `공용 선택창으로 옮긴 화면은 LEGACY_PICKERS에서 지워 주세요. 지울 파일: ${converted.join(', ')}`).toEqual([]);
  });

  it('허용 목록은 정렬돼 있고 중복 없이 실제 파일을 가리킨다', () => {
    expect([...LEGACY_PICKERS], '경로 순으로 정렬해 주세요').toEqual([...LEGACY_PICKERS].sort());
    expect(new Set(LEGACY_PICKERS).size).toBe(LEGACY_PICKERS.length);
    for (const path of LEGACY_PICKERS) expect(existsSync(join(ROOT, path)), path).toBe(true);
  });

  it('규칙 8: 코드(주석 제외)에 옛 이름 \'확장 배송비\'와 내부 값 \'저장 버전\'이 없다', () => {
    const sources = ['components/admin', 'app/admin', 'lib/admin']
      .flatMap((dir) => files(join(ROOT, dir), /\.(ts|tsx)$/))
      .map((path) => relative(ROOT, path))
      .filter((path) => !SKIP_FILE.test(path));
    expect(sources.length).toBeGreaterThan(500);
    const offenders = sources.filter((path) => /확장 배송비|저장 버전/.test(code(join(ROOT, path))));
    expect(offenders, '화면에 보이는 말이면 이름으로 바꾸고(확장 배송비 → 이 상품만의 배송비 규칙·수량별·착불 설정), 저장 버전은 보이지 않게 합니다').toEqual([]);
  });
});
