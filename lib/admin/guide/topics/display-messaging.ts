import type { AdminGuideTopic } from '../types';

export const DISPLAY_MESSAGING_TOPIC: AdminGuideTopic = {
  slug: 'display-messaging',
  title: '홈 큐레이션과 알림·메일',
  navLabel: '전시·알림',
  summary: '홈 화면 노출(히어로·특집 IP·공지 배너), 인앱 공지 발송, 메일 발송 이력을 다룹니다.',
  sections: [
    {
      id: 'curations',
      heading: '홈 큐레이션',
      paragraphs: [
        '홈 화면의 노출 영역은 세 종류입니다 — 홈 히어로(최상단 대형), 특집 IP, 공지 배너. 모두 홈 큐레이션 화면에서 등록합니다.',
        '헷갈리기 쉬운 구분: 홈에 보이는 배너는 큐레이션의 "공지 배너"이고, 사용자 알림함으로 보내는 공지는 알림·메시지의 "공지 발송"입니다. 서로 다른 기능입니다.',
      ],
      steps: [
        { text: '홈 큐레이션 화면에서 홈에 보일 영역(히어로/특집 IP/공지 배너)을 고릅니다.', screenHref: '/admin/display/curations' },
        {
          text: '제목, 눌렀을 때 이동할 화면, 노출 순서, 노출 기간(KST)을 입력합니다.',
          detail: [
            '이동할 화면은 목록에서 고르는 방식입니다 — 주소를 직접 입력하지 않으므로 깨진 링크가 생기지 않습니다.',
            '특집 IP는 특집할 IP를 함께 선택합니다.',
            '노출 종료를 비우면 계속 노출됩니다. 활성 체크를 끄면 기간과 무관하게 내려갑니다.',
          ],
        },
        { text: '아트워크(가로형 16:9)를 업로드하고 저장합니다.' },
      ],
      callouts: [
        {
          tone: 'warning',
          title: '히어로는 이미지가 없으면 홈에서 통째로 빠집니다',
          body: [
            '홈 히어로는 이미지가 필수입니다. 이미지 없이 저장하면 오류가 없어도 홈 화면에는 나타나지 않습니다.',
            '히어로에는 특집할 IP를 연결하지 않습니다 — IP가 연결된 히어로도 홈에서 걸러집니다. IP를 밀고 싶으면 특집 IP 영역을 쓰세요.',
          ],
        },
      ],
      screens: [{ href: '/admin/display/curations' }],
    },
    {
      id: 'notifications',
      heading: '인앱 공지 발송',
      paragraphs: [
        '공지 발송은 사용자의 인앱 알림함으로 즉시 들어가는 알림입니다. 이메일·푸시는 발송하지 않습니다.',
      ],
      steps: [
        {
          text: '공지 발송 화면에서 대상을 고릅니다 — 전체 사용자 또는 특정 IP의 팔로워.',
          screenHref: '/admin/messaging/notifications',
        },
        { text: '제목·본문을 작성하고 미리보기로 사용자에게 보일 모습을 확인합니다.' },
        {
          text: '발송 내용 확인을 거쳐 즉시 발송을 확정합니다.',
          detail: [
            '발송은 즉시 나가며 예약 발송은 없습니다. 발송 후 회수도 없으므로 확인 단계에서 오탈자·대상을 꼼꼼히 봐주세요.',
            '최근 발송 이력이 화면 아래에 남습니다.',
          ],
        },
      ],
      screens: [{ href: '/admin/messaging/notifications' }],
    },
    {
      id: 'emails',
      heading: '메일 발송 이력',
      paragraphs: [
        '주문확인·배송 시작 같은 자동 메일의 발송 성공/실패 이력을 보는 화면입니다. 실패한 건은 "다시 보내기"로 재발송할 수 있고, 같은 건을 여러 번 눌러도 중복 발송되지 않습니다.',
        '문의 답변 메일은 여기서 재발송할 수 없습니다 — 문의 상세에서 답변을 다시 등록해주세요.',
      ],
      screens: [{ href: '/admin/messaging/emails' }, { href: '/admin/cs/inquiries' }],
    },
  ],
};
