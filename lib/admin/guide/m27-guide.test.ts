import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CATEGORY_BULK_LINE_LIMIT, categoryBulkResultLabel } from '@/lib/admin/category-bulk';
import { ADMIN_CLAIM_BULK_ACTION_LABELS, ADMIN_CLAIM_BULK_LIMIT, ADMIN_CLAIM_BULK_OUTCOME_LABELS } from '@/lib/admin/claim-bulk';
import { REPLY_TEMPLATE_REPLACE_CONFIRM, REPLY_TEMPLATE_REPLACE_HINT } from '@/lib/admin/inquiry-reply-templates';
import { ADMIN_SCREENS } from '@/lib/admin/navigation';
import { GOODS_HTML_MAX_LENGTH } from '@/lib/goods-description';
import { RANDOM_OPTION_NOTICE } from '@/lib/goods-option-sale-mode';
import { GOOD_TYPES } from '@/lib/goods-taxonomy';
import { ORDER_CLAIM_BUYER_REASON_TYPES } from '@/lib/orders/claims';
import { ADMIN_GUIDE_TOPICS, type AdminGuideTopic, type AdminGuideTopicSlug } from './topics';

/*
 * 10/27 온라인몰 2차 회의 후속(m27) 가이드 정합.
 * 가이드가 옮겨 적은 화면 문구·버튼 이름·메뉴 경로가 지금 코드와 같은지, 바뀐 동작의 옛 문장이 남지 않았는지 고정한다.
 * 화면 문구가 바뀌면 여기가 깨진다 — 그때 가이드 본문도 함께 고친다.
 */

function repoFile(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

/** 렌더된(운영 어휘로 바꾼) 주제 본문 전체. 표·단계·콜아웃까지 펼친다. */
function plainText(topic: AdminGuideTopic): string {
  return [
    topic.title,
    topic.summary,
    ...topic.sections.flatMap((section) => [
      section.heading,
      ...(section.paragraphs ?? []),
      ...(section.list ?? []),
      ...(section.steps ?? []).flatMap((step) => [step.text, ...(step.detail ?? [])]),
      ...(section.callouts ?? []).flatMap((callout) => [callout.title, ...callout.body]),
      ...(section.table ? [...section.table.columns, ...section.table.rows.flat()] : []),
    ]),
  ].join('\n');
}

const guide = (slug: AdminGuideTopicSlug) => plainText(ADMIN_GUIDE_TOPICS[slug]);

describe('m27 가이드 — 고객문의·상담·리뷰(R1~R6)', () => {
  const text = guide('inquiries-reviews');

  it('미답변 배지는 고객문의 목록·상세에만 있다(R1)', () => {
    expect(repoFile('components/admin/AdminOpenInquiryBadge.tsx')).toContain('<span>미답변 1:1 문의</span>');
    expect(text).toContain('미답변 1:1 문의');
    expect(text).not.toContain('사이드바 메뉴 옆 배지');
  });

  it('새 1:1 문의 PC 알림을 켜고 끄는 법이 업무 도구의 실제 버튼 이름과 같다(R2)', () => {
    const notifier = repoFile('components/admin/AdminInquiryNotifier.tsx');
    for (const label of ['새 1:1 문의 PC 알림', '문의 알림 받기', '문의 알림 끄기']) {
      expect(notifier).toContain(label);
      expect(text).toContain(label);
    }
    expect(repoFile('components/admin/OperationsDock.tsx')).toContain("label: '알림'");
  });

  it('답변 템플릿은 덧붙이지 않고 바꾼다(R3)', () => {
    expect(text).toContain(REPLY_TEMPLATE_REPLACE_HINT);
    expect(text).toContain(REPLY_TEMPLATE_REPLACE_CONFIRM);
    for (const stale of ['작성 중인 답변 뒤에 추가', '현재 답글 뒤에 추가', '기존 작성 내용은 지우지 않습니다']) {
      expect(text).not.toContain(stale);
    }
  });

  it('답변처리는 목록 위 팝업으로 열린다(R4)', () => {
    expect(repoFile('components/admin/screens/InquiryQueueScreen.tsx')).toContain('목록 위 팝업');
    expect(repoFile('components/admin/screens/CustomerServiceDialog.tsx')).toContain('aria-label="닫기"');
    expect(repoFile('components/admin/screens/InquiryDetailScreen.tsx')).toContain('← 문의 목록');
    expect(text).toContain('목록 위 팝업');
    expect(text).toContain('← 문의 목록');
    expect(text).not.toContain('선택 닫기');
  });

  it('상담하기는 Enter로 보내고 고객문의 답변은 버튼으로 보낸다(R5)', () => {
    expect(repoFile('components/admin/screens/InquiryChatConversation.tsx')).toMatch(/event\.shiftKey/);
    expect(repoFile('components/admin/screens/InquiryReplyPanel.tsx')).toContain("'답변 발송'");
    expect(text).toContain('Shift+Enter');
    expect(text).toContain('"답변 발송"');
  });

  it('리뷰이벤트 화면의 적립금 정책 상태와 저장 전 비교를 안내한다(R6)', () => {
    const lib = repoFile('lib/review-events.ts');
    expect(lib).toContain('적립금 정책: 켜짐 · 보유 상한');
    expect(lib).toContain('적립금 정책: 꺼짐');
    expect(repoFile('lib/admin/navigation.ts')).toContain("label: '적립금 정책', href: '/admin/settings/store-credits', status: 'ready', adminOnly: true");
    expect(text).toContain('혜택/마케팅 → 적립금 정책');
    expect(text).toContain('보유 상한');
  });
});

describe('m27 가이드 — 클레임(R7·R8)', () => {
  const text = guide('claims');

  it('요청번호는 목록 위 팝업을 열고, 전체 화면 상세는 팝업 버튼으로 연다(R8)', () => {
    expect(repoFile('components/admin/screens/ClaimQueueScreen.tsx')).toContain('요청번호를 누르면 목록 위에 상세가 열리고');
    expect(repoFile('components/admin/screens/ClaimPreviewDialog.tsx')).toContain('전체 화면으로 열기');
    expect(text).toContain('요청번호를 누르면 목록 위');
    expect(text).toContain('"전체 화면으로 열기"');
  });

  it('선택 건 일괄 처리의 버튼·상한·결과 표기가 화면 계약과 같다(R8)', () => {
    for (const label of Object.values(ADMIN_CLAIM_BULK_ACTION_LABELS)) expect(text).toContain(`"${label}"`);
    expect(text).toContain(`최대 ${ADMIN_CLAIM_BULK_LIMIT}건`);
    expect(text).toContain(Object.values(ADMIN_CLAIM_BULK_OUTCOME_LABELS).join('·'));
    expect(text).toContain('한 건씩 순서대로');
  });

  it('거부 사유 프리셋과 유형별 사유, 운영자 철회 버튼 제거를 안내한다(R7)', () => {
    expect(repoFile('components/admin/screens/ClaimRejectionReasonField.tsx')).toContain('자주 쓰는 거부 사유');
    expect(ORDER_CLAIM_BUYER_REASON_TYPES.cancel).toEqual(['change_of_mind']);
    expect(text).toContain('자주 쓰는 거부 사유');
    expect(text).toContain('취소는 단순 변심 사유만 받습니다');
    expect(text).not.toContain('고객과 합의한 담당자가 요청만 종결');
    expect(text).toContain('운영자 화면에는 철회 버튼이 없');
  });
});

describe('m27 가이드 — 상품 등록·목록·카테고리·랜덤 판매(R9~R21·R24·R25)', () => {
  const text = guide('goods-sales');
  const section = (id: string) => ADMIN_GUIDE_TOPICS['goods-sales'].sections.find((item) => item.id === id);

  it('등록 화면 한 번에 저장과 자리표시 운영 섹션을 안내한다(R13·D6②)', () => {
    const editor = repoFile('components/admin/GoodEditor.tsx');
    expect(editor).toContain('기본 상품·이미지·옵션·고시·배송·구매 제한·판매 조건과 아래 KC·예약판매 입력을 한 번에 저장합니다.');
    expect(repoFile('components/admin/sections/GoodSection.tsx')).toContain("Placeholder id=\"prices\"");
    expect(text).toContain('KC·예약판매 입력을 한 번에 저장');
    expect(text).toContain('자리표시');
    expect(text).not.toContain('초안 저장 → KC 검토 → 공개');
    expect(text).not.toContain('고정 저장 영역은 기본 상품·이미지·옵션·고시·배송·판매 조건만 저장합니다.');
  });

  it('잠긴 운영 섹션의 이유·저장 위치 바로가기와 펼침 유지를 안내한다(R14)', () => {
    expect(repoFile('components/admin/GoodWorkspace.tsx')).toContain('저장 위치로 이동');
    expect(text).toContain('"저장 위치로 이동"');
  });

  it('구매 제한 카드의 위치·어휘와 옵션별 구매 제한을 화면과 같게 부른다(R12·D7②)', () => {
    const fields = repoFile('components/admin/GoodsSalePolicyFields.tsx');
    for (const label of ['title="구매 제한"', 'legend="최소/최대 구매수량"', 'legend="1인 최대 구매수량"', '<legend>옵션별 구매 제한 (선택)</legend>', '최대 구매수량(주문당)']) {
      expect(fields).toContain(label);
    }
    for (const label of ['구매 제한 카드', '최소/최대 구매수량', '1인 최대 구매수량', '옵션별 구매 제한', '최대 구매수량(주문당)']) {
      expect(text).toContain(label);
    }
    expect(text).not.toContain('판매 조건의 주문당 수량 제한');
    expect(text).toContain(`'옵션명'은 한 번에 N개까지 주문할 수 있습니다.`);
    expect(repoFile('lib/goods-option-sale-mode.ts')).toContain("은 한 번에 ${limit.orderMaxQty}개까지 주문할 수 있습니다.");
  });

  it('할인 결과 표기와 숫자 입력 동작을 안내한다(R18)', () => {
    expect(repoFile('lib/admin/goods-price-editor.ts')).toContain("'할인가 X원 (Y원, Z% 할인)'");
    expect(text).toContain('할인가 X원 (Y원, Z% 할인)');
  });

  it('상세 HTML 상한과 엑셀 긴 설명 표식을 안내한다(R17)', () => {
    expect(text).toContain(`정리된 코드까지 ${GOODS_HTML_MAX_LENGTH.toLocaleString('ko-KR')}자`);
    expect(text).not.toContain('30,000자');
    expect(text).toContain('[상품 편집에서만 수정]');
    expect(text).toContain('32,767자');
  });

  it('카테고리 일괄 등록·0건 안내·유형 기타·ERP 전체 경로 연결을 안내한다(R9·R10)', () => {
    expect(repoFile('components/admin/screens/CategoryScreen.tsx')).toContain('title="카테고리 일괄 등록"');
    expect(text).toContain('카테고리 일괄 등록');
    expect(text).toContain(`${CATEGORY_BULK_LINE_LIMIT.toLocaleString('ko-KR')}줄`);
    expect(text).toContain((['created', 'skipped', 'failed'] as const).map(categoryBulkResultLabel).join('·'));
    expect(repoFile('components/admin/CategoryAssignmentField.tsx')).toContain('등록된 카테고리가 없습니다. 카테고리 관리에서 먼저 등록하세요.');
    expect(text).toContain('등록된 카테고리가 없습니다');
    expect(GOOD_TYPES).toContain('기타');
    expect(text).not.toContain('기존 8종');
    expect(repoFile('components/admin/ErpCategoryMappingPanel.tsx')).toContain('말단 이름만 같은 다른 경로는 연결하지 않습니다.');
    expect(text).toContain('말단 이름만 같은 다른 경로는 연결하지 않습니다');
    expect(text).not.toContain('같은 이름으로 연결');
  });

  it('사진 보관함 용도와 업로드 뒤 동작을 화면 문구 그대로 안내한다(R20)', () => {
    const purpose = repoFile('components/admin/screens/GoodsPhotoLibraryScreen.tsx').match(/GOODS_PHOTO_LIBRARY_PURPOSE = '([^']+)'/)?.[1];
    expect(purpose).toBeTruthy();
    expect(text).toContain(purpose!);
  });

  it('상품 목록의 선택 유지·상품번호 열·판매기간 필터·그룹상품 메뉴 숨김을 안내한다(R11·R15·R16·R21)', () => {
    expect(repoFile('components/admin/marketing/MarketingLinksGoodsGrid.tsx')).toContain('선택 해제');
    expect(repoFile('components/admin/screens/GoodsListFiltersForm.tsx')).toContain('판매대기 (시작 전)');
    expect(repoFile('components/admin/screens/GoodsListScreen.tsx')).toContain("label: '상품번호'");
    const groups = ADMIN_SCREENS.filter((screen) => screen.href.startsWith('/admin/catalog/groups'));
    expect(groups.length).toBeGreaterThan(0);
    expect(groups.every((screen) => screen.navHidden)).toBe(true);
    expect(text).toContain('선택 해제');
    expect(text).toContain('상품번호를 누르면');
    expect(text).toContain('판매대기(시작 전)');
    expect(text).toContain('사이드바에서 숨겼습니다');
  });

  it('판매 방식(랜덤 판매) 절이 패널의 선택지·고객 은닉 범위·조건과 같다(R24·D5②)', () => {
    const panel = repoFile('components/admin/GoodsOptionSaleModePanel.tsx').replace(/&apos;/g, "'").replace(/\s+/g, ' ');
    const hidden = "고객의 상품·장바구니·주문·메일·리뷰에는 '랜덤'으로 보이고 옵션별 재고도 보이지 않습니다. 교환으로 다시 보내는 상품은 보내는 옵션이 고객에게 안내됩니다.";
    expect(panel).toContain(hidden);
    for (const label of ['옵션 선택 판매', '랜덤 판매', '판매 방식 저장']) expect(panel).toContain(label);
    const randomSection = section('option-sale-mode');
    expect(randomSection?.heading).toContain('판매 방식');
    const randomText = plainText({ ...ADMIN_GUIDE_TOPICS['goods-sales'], title: '', summary: '', sections: randomSection ? [randomSection] : [] });
    expect(randomText).toContain(hidden);
    expect(randomText).toContain("상품 수정 화면의 '판매 방식'에서 옵션 선택 판매와 랜덤 판매");
    expect(randomText).toContain(RANDOM_OPTION_NOTICE);
    for (const condition of ['2개 이상', '첫 번째(기본) 옵션', '예약판매', '직접 입력', '옵션별 구매 제한', '그룹상품']) expect(randomText).toContain(condition);
  });

  it('쿠폰은 장바구니와 주문서에서 고른다(R25)', () => {
    expect(repoFile('components/screens/Checkout.tsx')).toContain('CouponPicker');
    expect(text).toContain('장바구니나 주문서에서');
    expect(text).not.toContain('쿠폰은 장바구니에서 고객이 직접 선택하거나');
  });
});
