import type { AdminGuideTopic } from '../types';

export const MEMBERS_ROLES_TOPIC: AdminGuideTopic = {
  slug: 'members-roles',
  title: '회원·모더레이션·역할',
  navLabel: '회원·모더레이션',
  summary: '신고 처리와 게시물 숨김, 회원 조회·정지, 운영 역할 부여를 다룹니다.',
  sections: [
    {
      id: 'moderation',
      heading: '신고 처리 (모더레이션)',
      steps: [
        { text: '모더레이션 화면에서 접수된 신고 목록을 확인합니다.', screenHref: '/admin/community/moderation' },
        {
          text: '신고된 포스트·댓글을 확인하고 필요하면 숨김 처리합니다.',
          detail: [
            '리뷰에 대한 신고는 이 화면에서 직접 처리하지 않고 "리뷰 관리에서 열기" 링크로 리뷰 관리 화면에서 처리합니다.',
          ],
        },
        { text: '신고 건의 처리 상태를 저장해 남은 신고와 처리된 신고를 구분합니다.' },
      ],
      screens: [{ href: '/admin/community/moderation' }, { href: '/admin/cs/reviews' }],
    },
    {
      id: 'members',
      heading: '회원 조회와 정지',
      steps: [
        { text: '회원 화면에서 닉네임·이메일로 검색합니다.', screenHref: '/admin/community/members' },
        { text: '회원 상세에서 주문·티켓·신고 이력을 확인합니다.' },
        {
          text: '규정 위반 회원은 내부 정지 사유를 적고 정지합니다.',
          detail: [
            '정지된 회원은 포스트·댓글 작성, 구매·예매, 카드팩 개봉, 게임 플레이를 새로 진행할 수 없습니다. 처리 전 확인 창이 이 내용을 다시 보여줍니다.',
            '정지 사유는 내부 기록입니다. 사정이 해소되면 같은 화면에서 정지를 해제합니다.',
          ],
        },
      ],
      callouts: [
        {
          tone: 'info',
          title: '정지 권한의 범위',
          body: [
            'staff는 일반 회원만 정지할 수 있습니다. 운영 역할이 있는 계정의 정지는 admin의 일이며, 본인과 admin 계정은 누구도 정지할 수 없습니다.',
          ],
        },
      ],
      screens: [{ href: '/admin/community/members' }],
    },
    {
      id: 'grades-dormancy',
      heading: '등급 · 휴면 · 구매 실적',
      paragraphs: [
        '회원 목록에 등급과 구매 실적이 함께 나옵니다. 실적은 주문이 결제 확정될 때마다 그 회원 것만 다시 세고, 취소되면 다시 빠집니다 — 목록의 숫자와 주문 내역이 어긋나지 않습니다.',
        '등급은 매일 밤 한 번 전체를 다시 계산합니다. 전에는 결제나 취소가 있을 때만 계산해서, 산정 기간이 지나도 등급이 내려가지 않았습니다.',
      ],
      list: [
        '상태(활동중·휴면·정지)와 등급으로 목록을 좁힐 수 있고, 좁힌 조건은 주소에 남아 그대로 다시 열거나 남에게 보낼 수 있습니다.',
        '등급 문턱(얼마부터 실버인가)은 관리자만 바꿀 수 있습니다. 매출 정책이라 담당자가 혼자 내리는 값이 아닙니다.',
        '문턱은 낮은 등급보다 높은 등급이 항상 커야 합니다. 뒤집으면 저장이 막힙니다 — 어느 등급인지 정할 수 없기 때문입니다.',
      ],
      callouts: [
        {
          tone: 'info',
          title: '휴면은 우리 정책입니다',
          body: [
            '법이 요구하던 휴면 분리보관은 2023년에 폐지됐습니다. 지금 휴면은 「오래 안 오신 분에게 마케팅을 멈추는」 우리 정책의 표시이고, 로그인하면 자동으로 풀립니다.',
            '자동 전환(12개월 미접속 → 안내 → 30일 뒤 휴면)은 **아직 켜지 않았습니다.** 개인정보처리방침에 그 정책을 적은 뒤에 켜야 하고, 그건 사람이 정할 일입니다. 지금은 회원 상세에서 하나씩 바꿀 수 있습니다.',
          ],
        },
      ],
      screens: [{ href: '/admin/community/members' }],
    },
    {
      id: 'roles',
      heading: '역할 부여 (admin 전용)',
      paragraphs: [
        '역할 화면은 admin에게만 보입니다. staff 계정에는 메뉴에도 나타나지 않고 주소로 들어가도 열리지 않습니다.',
        '회원의 역할을 user·staff·admin 중 하나로 저장합니다. 본인 계정의 역할은 바꿀 수 없고, 정지된 계정에는 staff·admin을 부여할 수 없습니다.',
        '목록은 최근 가입 50명까지만 표시되고 검색이 없습니다. 새 팀원 승격은 가입 직후에 처리하는 것이 가장 쉽고, 그보다 오래된 계정의 승격은 개발팀에 요청해야 합니다.',
      ],
      screens: [{ href: '/admin/community/roles', note: 'admin 전용' }],
    },
  ],
};
