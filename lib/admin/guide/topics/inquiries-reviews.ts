import { INQUIRY_AUTO_CLOSE_DAYS } from '@/lib/inquiries';
import { LOW_REVIEW_RATING_MAX } from '@/lib/reviews';
import type { AdminGuideTopic } from '../types';

export const INQUIRIES_REVIEWS_TOPIC: AdminGuideTopic = {
  slug: 'inquiries-reviews',
  title: '문의·Q&A·리뷰 관리',
  navLabel: '문의·리뷰',
  summary: '비공개 1:1 문의 답변, 굿즈 상세에 공개되는 상품 Q&A, 리뷰 답글·블라인드 처리 방법입니다.',
  sections: [
    {
      id: 'inquiries',
      heading: '1:1 문의 답변',
      paragraphs: [
        '1:1 문의는 고객이 운영자에게 보내는 비공개 질문입니다. 접수 절차가 정해진 클레임과 달리 자유로운 질문·요청이 들어오며, 미답변 건수는 사이드바 메뉴 옆 배지로 표시됩니다.',
      ],
      steps: [
        { text: '1:1 문의 목록을 엽니다. 제목·구매자·주문번호·문의번호로 검색할 수 있습니다.', screenHref: '/admin/cs/inquiries' },
        {
          text: '문의를 열어 스레드와 연결 정보를 확인합니다.',
          detail: [
            '주문에 연결된 문의는 주문번호·상태·굿즈·결제·운송장·클레임 현황이 한 화면에 함께 표시되어 다른 화면을 오가지 않고 답할 수 있습니다.',
          ],
        },
        {
          text: '답변을 작성해 등록합니다.',
          detail: [
            '자주 쓰는 답변은 템플릿으로 저장해 두고 불러 쓸 수 있습니다. 템플릿은 저장·삭제만 되므로 내용을 고칠 때는 새로 저장합니다.',
          ],
        },
      ],
      callouts: [
        {
          tone: 'info',
          title: '답변 후 자동 종결',
          body: [
            `답변 후 고객 추가 응답이 ${INQUIRY_AUTO_CLOSE_DAYS}일 동안 없으면 문의는 자동 종결됩니다. 필요하면 상세에서 직접 종결할 수도 있습니다.`,
            '문의 답변 메일은 메일 발송 이력에서 재발송할 수 없습니다 — 전달이 안 됐다면 문의 상세에서 답변을 다시 등록해주세요.',
          ],
        },
      ],
      screens: [{ href: '/admin/cs/inquiries' }],
    },
    {
      id: 'qna',
      heading: '상품 Q&A 답변',
      paragraphs: [
        '상품 Q&A는 굿즈 상세에 공개로 남는 구매 전 질문입니다. 비공개 스레드인 1:1 문의와 별개 채널이므로, 개인정보·주문 관련 상담이 Q&A로 들어오면 답변에서 1:1 문의로 안내해주세요.',
      ],
      steps: [
        { text: '상품 Q&A 화면에서 답변 대기 질문을 확인합니다.', screenHref: '/admin/cs/qna' },
        {
          text: '답변(1~2,000자)을 등록합니다.',
          detail: [
            '답변은 굿즈 상세에 바로 공개되고 작성자에게 알림이 갑니다.',
            '같은 질문에 답변을 다시 저장하면 내용이 갱신됩니다 — 갱신할 때마다 작성자에게 알림이 다시 가므로 저장 전에 문구를 확정해주세요.',
          ],
        },
        {
          text: '규정을 어긴 질문은 비노출 처리합니다.',
          detail: [
            '비노출은 삭제가 아닙니다 — 굿즈 상세에서는 즉시 빠지지만 원문은 남고, 작성자는 자기 질문을 계속 볼 수 있습니다. 판단이 바뀌면 다시 공개할 수 있습니다.',
          ],
        },
      ],
      screens: [{ href: '/admin/cs/qna' }],
    },
    {
      id: 'reviews',
      heading: '리뷰 관리',
      paragraphs: [
        '리뷰는 배송완료된 굿즈에 구매자가 남기는 공개 후기입니다. 운영자는 답글을 달거나, 규정을 어긴 리뷰를 블라인드 처리할 수 있습니다.',
      ],
      steps: [
        {
          text: '리뷰 관리 화면에서 대상을 찾습니다.',
          screenHref: '/admin/cs/reviews',
          detail: [
            `저평점 필터(별점 ${LOW_REVIEW_RATING_MAX}점 이하), 사진 여부, 미처리 신고, 답글 여부로 좁힐 수 있습니다.`,
            '커뮤니티 모더레이션에 접수된 리뷰 신고는 "리뷰 관리에서 열기" 링크로 이 화면에 연결됩니다.',
          ],
        },
        {
          text: '답글을 등록합니다. 운영자 답글은 리뷰 아래에 공개로 표시됩니다.',
        },
        {
          text: '규정 위반 리뷰는 사유를 남기고 블라인드 처리합니다. 판단이 바뀌면 블라인드를 해제할 수 있습니다.',
        },
      ],
      callouts: [
        {
          tone: 'warning',
          title: '낮은 별점은 블라인드 사유가 아닙니다',
          body: [
            '블라인드는 욕설·개인정보 노출처럼 규정을 어긴 경우를 위한 조치입니다. 불만 리뷰에는 블라인드 대신 답글로 응대해주세요.',
          ],
        },
      ],
      screens: [{ href: '/admin/cs/reviews' }, { href: '/admin/community/moderation' }],
    },
  ],
};
