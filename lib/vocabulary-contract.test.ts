import { readFileSync, readdirSync, statSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/** These exceptions describe semantic boundaries, never arbitrary legacy debt. */
const ADMIN_COPY_EXCEPTIONS = [
  { file: 'components/admin/sections/RewardPolicySection.tsx', reason: '카드팩 지급 정책의 굿즈 결제 자격 문맥은 ADR-0014의 카드 화면 예외다.' },
  { file: 'components/admin/sections/GameSection.tsx', reason: '읽기 전용 legacy goods variant는 상품 판매 설정이 아닌 게임 도메인 이름이다.' },
  { file: 'lib/admin/guide/topics/cards-games.ts', reason: '카드·카드팩·게임 안내는 운영 상품 어휘 변환 대상이 아니다.' },
  { file: 'lib/admin/guide/topics/events-tickets.ts', reason: '티켓 안내는 운영 상품 어휘 변환 대상이 아니다.' },
  { file: 'lib/admin/good-preview.ts', text: '(굿즈 이름 미입력)', reason: '고객용 굿즈 미리보기에 쓰는 임시 이름이다.' },
  { file: 'components/admin/screens/ClaimQueueKitScreen.tsx', text: '약관 제16조', reason: '굿즈를 반환받은 날부터 3영업일이라는 약관 원문 인용을 보존한다.' },
  { file: 'app/admin/actions.ts', text: '이전 굿즈 보상형 게임은 보기만 할 수 있고, 지금은 운영하지 않아 고칠 수 없습니다.', reason: '실물 판매와 구분하는 폐기된 게임 variant 안내다.' },
  { file: 'app/admin/actions.ts', text: '선택한 IP의 굿즈만 지정할 수 있습니다.', reason: '카드팩 리워드 정책의 결제 자격 검증 오류다.' },
  { file: 'app/admin/actions.ts', text: '연결할 굿즈를 찾을 수 없습니다.', reason: '카드팩 리워드 정책의 결제 자격 검증 오류다.' },
  { file: 'lib/admin/catalog.ts', text: '등록된 굿즈를 선택해주세요.', reason: '카드팩 리워드 정책의 결제 자격 검증 오류다.' },
  { file: 'lib/admin/catalog.ts', text: '선택한 IP의 굿즈만 지정할 수 있습니다.', reason: '카드팩 리워드 정책의 결제 자격 검증 오류다.' },
  { file: 'lib/admin/sabangnet-goods-format.ts', text: '추가상품그룹코드', reason: '사방넷 상품 양식의 원본 열 이름이라 운영 어휘로 바꾸면 열을 인식하지 못한다.' },
  { file: 'lib/admin/sabangnet-goods-format.ts', text: '추가 상품상세설명', reason: '사방넷 상품 양식의 원본 열 이름이라 운영 어휘로 바꾸면 열을 인식하지 못한다.' },
] as const;
const MAPPED_GUIDE_SOURCES = {
  'lib/admin/guide/topics/goods-sales.ts': 'topics.ts의 operatorTopic이 모든 정적 제목·본문·표를 변환한다.',
  'lib/admin/guide/topics/orders-shipping.ts': 'topics.ts의 operatorTopic이 모든 정적 제목·본문·표를 변환한다.',
  'lib/admin/guide/topics/claims.ts': 'topics.ts의 operatorTopic이 모든 정적 제목·본문·표를 변환한다.',
  'lib/admin/guide/topics/inquiries-reviews.ts': 'topics.ts의 operatorTopic이 모든 정적 제목·본문·표를 변환한다.',
  'lib/admin/guide/topics/troubleshooting.ts': 'topics.ts의 operatorTopic이 인용 오류를 포함한 정적 문구를 변환한다.',
  'lib/admin/guide/topics/display-messaging.ts': 'topics.ts의 operatorTopic이 모든 정적 제목·본문·표를 변환한다.',
  'lib/admin/guide/topics/stats.ts': 'topics.ts의 operatorTopic이 모든 정적 제목·본문·표를 변환한다.',
} as const;

function sourceFiles(file: string): string[] {
  if (!statSync(file).isDirectory()) return [file];
  return readdirSync(file, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? sourceFiles(`${file}/${entry.name}`)
    : /\.(?:ts|tsx)$/.test(entry.name) && !entry.name.includes('.test.') ? [`${file}/${entry.name}`] : []);
}
interface CopyLiteral { file: string; line: number; text: string; mapped: boolean }
function isOperatorMapped(node: ts.Node): boolean {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isCallExpression(parent) && ts.isIdentifier(parent.expression)
      && ['adminGoodsCopy', 'adminGoodsNotice'].includes(parent.expression.text)) return true;
  }
  return false;
}
function literals(file: string): CopyLiteral[] {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const result: CopyLiteral[] = [];
  function visit(node: ts.Node) {
    if (ts.isStringLiteralLike(node) || ts.isJsxText(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      result.push({ file, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
        text: node.text.replace(/\s+/g, ' ').trim(), mapped: isOperatorMapped(node) });
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return result;
}
function excepted(copy: CopyLiteral, exceptions: readonly { file: string; text?: string; reason: string }[]) {
  return exceptions.some(exception => exception.file === copy.file && (!exception.text || copy.text.includes(exception.text)));
}

const ADMIN_SOURCES = ['app/admin', 'app/api/admin', 'components/admin', 'lib/admin'];
/* 고객 화면에서 '상품'을 막던 공개 어휘 검사는 2026-11-24 사용자 결정("업계 권장대로 … '굿즈'가 아니라 상품이야")으로 없앴다.
   고객 화면도 업계 표기 '상품'을 쓴다. 어드민 운영 어휘(상품) 검사와 카드팩 어휘 분리는 그대로다. */
const CARD_PACK_EXCHANGE_SOURCES = ['components/campaign/ExchangePanel.tsx', 'app/events/participation-actions.ts'];
/* 두 전수 검사는 범위 안 모든 TS/TSX 를 TypeScript 파서로 훑어 코드가 늘수록 느려진다 — 로컬 약 2.6초, CI 러너에서는
   기본 5초 경계(5.0~5.5초)를 넘겨 앱 변경이 없는 PR 도 실패했다(2026-11-18 #666·#668). 검사 범위는 그대로 두고 제한만 늘린다. */
const FULL_SCAN_TIMEOUT_MS = 20_000;

describe('관리자 상품 어휘 계약 (#503)', () => {
  it('관리자 정적 문구의 굿즈는 운영 어휘 매핑을 거친다', () => {
    const violations = ADMIN_SOURCES.flatMap(sourceFiles).flatMap(literals)
      .filter(copy => /굿즈|추가\s*상품|추가\s+구성\s*상품|추가구성\s+상품/.test(copy.text.replace(/굿즈샵|굿즈 마켓/g, '')) && !copy.mapped
        && !Object.hasOwn(MAPPED_GUIDE_SOURCES, copy.file) && !excepted(copy, ADMIN_COPY_EXCEPTIONS));
    expect(violations).toEqual([]);
  }, FULL_SCAN_TIMEOUT_MS);
  it('카드팩 교환 문구는 실물 굿즈와 유료 가챠 어휘를 쓰지 않는다', () => {
    const violations = CARD_PACK_EXCHANGE_SOURCES.flatMap(literals)
      .filter(copy => /상품|굿즈|가챠|뽑기|충전/.test(copy.text));
    expect(violations).toEqual([]);
  });
  it('모든 예외와 일괄 매핑 경로는 구체적인 이유를 남긴다', () => {
    for (const item of ADMIN_COPY_EXCEPTIONS) expect(item.reason.length).toBeGreaterThan(20);
    for (const reason of Object.values(MAPPED_GUIDE_SOURCES)) expect(reason.length).toBeGreaterThan(20);
  });
});
