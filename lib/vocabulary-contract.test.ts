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
  { file: 'components/admin/screens/ClaimQueueScreen.tsx', text: '약관 제16조', reason: '굿즈를 반환받은 날부터 3영업일이라는 약관 원문 인용을 보존한다.' },
  { file: 'app/admin/actions.ts', text: 'legacy 굿즈 게임은 읽기 전용이며 현 로드맵에서 운영하지 않습니다.', reason: '실물 판매와 구분하는 폐기된 게임 variant 안내다.' },
  { file: 'app/admin/actions.ts', text: '선택한 IP의 굿즈만 지정할 수 있습니다.', reason: '카드팩 리워드 정책의 결제 자격 검증 오류다.' },
  { file: 'app/admin/actions.ts', text: '연결할 굿즈를 찾을 수 없습니다.', reason: '카드팩 리워드 정책의 결제 자격 검증 오류다.' },
  { file: 'lib/admin/catalog.ts', text: '등록된 굿즈를 선택해주세요.', reason: '카드팩 리워드 정책의 결제 자격 검증 오류다.' },
  { file: 'lib/admin/catalog.ts', text: '선택한 IP의 굿즈만 지정할 수 있습니다.', reason: '카드팩 리워드 정책의 결제 자격 검증 오류다.' },
  { file: 'lib/admin/sabangnet-goods-format.ts', text: '추가상품그룹코드', reason: '사방넷 상품 양식의 원본 열 이름이라 운영 어휘로 바꾸면 열을 인식하지 못한다.' },
  { file: 'lib/admin/sabangnet-goods-format.ts', text: '추가 상품상세설명', reason: '사방넷 상품 양식의 원본 열 이름이라 운영 어휘로 바꾸면 열을 인식하지 못한다.' },
] as const;
const PUBLIC_COPY_EXCEPTIONS = [
  { file: 'components/screens/GoodDetail.tsx', text: '전자상거래법에 따라 표시하는 상품정보제공고시 항목입니다.', reason: '상품정보제공고시는 법정 고시의 이름이므로 바꾸지 않는다.' },
  ...[
    '상품 Q&A에 답변이 등록됐어요', '교환 상품이 재출고됐어요',
    '입고가 확인됐습니다. 교환 상품 재출고를 준비합니다.', '교환 상품을 새 운송장으로 발송했습니다.',
  ].map(text => ({ file: 'lib/notifications.ts', text, reason: '기존 DB 시스템 알림을 고객 어휘로 표시하기 위한 정확한 원문 매칭 키다.' })),
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

const PUBLIC_SOURCES = [
  'components/shop', 'components/orders', 'app/cart', 'app/checkout', 'app/orders', 'app/shop', 'app/my',
  'app/help', 'components/campaign', 'app/events/participation-actions.ts',
  ...['GoodDetail', 'Cart', 'Checkout', 'CheckoutOrder', 'OrderDetail', 'Orders', 'MyPage', 'MyQuestions', 'MyReviews',
    'MyCoupons', 'MyStoreCredits', 'Wishlist', 'Inquiries', 'Notifications', 'Home', 'CampaignLanding'].map(name => `components/screens/${name}.tsx`),
  'components/wc/MypageShell.tsx', 'components/wc/ProductCard.tsx', 'components/shell/CartProvider.tsx',
  ...['checkout', 'fulfillment', 'shipping', 'product-questions', 'inquiries', 'cart', 'goods-sales', 'goods-options', 'goods-claim-policy', 'orders', 'notifications'].map(name => `lib/${name}.ts`),
];
const CARD_PACK_EXCHANGE_SOURCES = ['components/campaign/ExchangePanel.tsx', 'app/events/participation-actions.ts'];

describe('관리자·공개 굿즈 어휘 계약 (#503)', () => {
  it('관리자 정적 문구의 굿즈는 운영 어휘 매핑을 거친다', () => {
    const violations = ['app/admin', 'components/admin', 'lib/admin'].flatMap(sourceFiles).flatMap(literals)
      .filter(copy => /굿즈|추가\s*상품|추가\s+구성\s*상품|추가구성\s+상품/.test(copy.text.replace(/굿즈샵|굿즈 마켓/g, '')) && !copy.mapped
        && !Object.hasOwn(MAPPED_GUIDE_SOURCES, copy.file) && !excepted(copy, ADMIN_COPY_EXCEPTIONS));
    expect(violations).toEqual([]);
  });
  it('공개 굿즈·참여 표면은 법정 고시 명칭 외에 상품이라는 별칭을 쓰지 않는다', () => {
    const violations = PUBLIC_SOURCES.flatMap(sourceFiles).flatMap(literals)
      .filter(copy => copy.text.includes('상품') && !excepted(copy, PUBLIC_COPY_EXCEPTIONS));
    expect(violations).toEqual([]);
  });
  it('카드팩 교환 문구는 실물 굿즈와 유료 가챠 어휘를 쓰지 않는다', () => {
    const violations = CARD_PACK_EXCHANGE_SOURCES.flatMap(literals)
      .filter(copy => /상품|굿즈|가챠|뽑기|충전/.test(copy.text));
    expect(violations).toEqual([]);
  });
  it('모든 예외와 일괄 매핑 경로는 구체적인 이유를 남긴다', () => {
    for (const item of [...ADMIN_COPY_EXCEPTIONS, ...PUBLIC_COPY_EXCEPTIONS]) expect(item.reason.length).toBeGreaterThan(20);
    for (const reason of Object.values(MAPPED_GUIDE_SOURCES)) expect(reason.length).toBeGreaterThan(20);
  });
});
