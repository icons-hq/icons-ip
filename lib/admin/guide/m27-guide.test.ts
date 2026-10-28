import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ADMIN_CLAIM_BULK_ACTION_LABELS, ADMIN_CLAIM_BULK_LIMIT, ADMIN_CLAIM_BULK_OUTCOME_LABELS } from '@/lib/admin/claim-bulk';
import { REPLY_TEMPLATE_REPLACE_CONFIRM, REPLY_TEMPLATE_REPLACE_HINT } from '@/lib/admin/inquiry-reply-templates';
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
