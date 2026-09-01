import { DRAW_TICKET_GRANT_MAX_QUANTITY } from '@/lib/admin/draw-ticket-grants';
import type { AdminGuideTopic } from '../types';

export const CARDS_GAMES_TOPIC: AdminGuideTopic = {
  slug: 'cards-games',
  title: '카드·카드팩·게임 운영',
  navLabel: '카드·게임',
  summary: '수집형 디지털 카드와 카드풀, 카드팩 발급 정책, 참여형 게임을 등록·운영하는 절차와 잠금 규칙입니다.',
  sections: [
    {
      id: 'overview',
      heading: '이 도메인의 원칙',
      paragraphs: [
        '카드는 실물 굿즈와 별개인 수집형 디지털 카드입니다. 돈으로 살 수 없고, 굿즈 주문 확정 등으로 발급되는 카드팩 개봉이나 참여형 게임 보상 같은 무상 경로로만 지급됩니다.',
        '운영 순서는 보통 이렇습니다 — 카드풀을 만들고 → 카드를 등록해 풀에 연결하고 → 등급별 확률을 100%로 맞춘 뒤 → 발급 정책이나 게임이 그 풀을 가리키게 합니다.',
      ],
      callouts: [
        {
          tone: 'warning',
          title: '이력이 생기면 잠깁니다',
          body: [
            '카드팩 발급·개봉·게임 플레이 이력이 생긴 뒤에는 관련 설정(풀 구성, 게임 설정, 정책의 대상 풀 등)이 잠겨 변경할 수 없습니다. 발급 확률과 이력의 추적 가능성을 지키기 위한 규칙이므로, 운영 시작 전에 구성을 확정해주세요.',
          ],
        },
      ],
    },
    {
      id: 'pools',
      heading: '카드풀 만들기',
      steps: [
        {
          text: '카드풀 화면에서 연결 IP, 카드풀 이름, 운영 시작(KST)을 입력해 저장합니다. 운영 종료는 선택입니다.',
          screenHref: '/admin/catalog/pools',
          detail: [
            '운영 기간이 끝나면 신규 발급만 멈춥니다. 이미 발급된 미개봉 카드팩은 계속 개봉할 수 있습니다.',
          ],
        },
        {
          text: '별도의 확률 폼에서 등급(N·R·SR·SSR·HOLO)별 확률을 입력합니다.',
          detail: [
            '소수 셋째 자리까지 입력할 수 있고, 다섯 칸의 합계가 정확히 100%여야 저장됩니다.',
          ],
        },
      ],
      callouts: [
        {
          tone: 'info',
          title: '"운영 가능" 조건',
          body: [
            '확률 합계가 100%이고, 확률이 0보다 큰 모든 등급에 소속 카드가 최소 1장씩 있어야 풀이 운영 가능 상태가 됩니다. 이 상태가 되어야 발급 정책과 게임이 그 풀을 선택할 수 있습니다.',
          ],
        },
        {
          tone: 'warning',
          title: '풀의 IP는 나중에 못 바꿉니다',
          body: [
            '발급 정책·게임·카드팩·발급 이력이 연결된 카드풀은 IP를 변경할 수 없습니다.',
            '카드풀의 운영 기간은 연결된 게임의 운영 기간 전체를 포함해야 합니다.',
          ],
        },
      ],
      screens: [{ href: '/admin/catalog/pools' }],
    },
    {
      id: 'cards',
      heading: '카드 등록',
      steps: [
        {
          text: '카드 화면에서 ID, 연결 IP, 카드 이름, 번호(예: 001/120), 등급을 입력하고 카드풀을 연결해 저장합니다.',
          screenHref: '/admin/catalog/cards',
        },
        { text: '카드 아트워크를 업로드하고 저장합니다. 규격은 굿즈 이미지와 같습니다.' },
      ],
      callouts: [
        {
          tone: 'warning',
          title: '풀에 연결된 카드의 잠금',
          body: [
            '풀에 연결된 카드는 IP·등급을 바꿀 수 없습니다. 바꾸려면 먼저 풀 연결을 해제해야 합니다.',
            '어떤 등급의 마지막 남은 양수 확률 카드는 풀에서 빼거나 옮길 수 없습니다 — 그 등급이 당첨 불가능해지기 때문입니다.',
          ],
        },
      ],
      screens: [{ href: '/admin/catalog/cards' }],
    },
    {
      id: 'policies',
      heading: '카드팩 발급 정책',
      paragraphs: [
        '발급 정책은 "어떤 굿즈 주문이 결제되면 어느 풀의 카드팩을 몇 개 줄지"를 정합니다. 트리거는 주문 결제로 고정되어 있습니다.',
      ],
      steps: [
        {
          text: '발급 정책 화면에서 대상 IP, 대상 굿즈, 발급 카드풀, 최소 결제 금액, 발급 카드팩 수(1~100), 운영 기간을 입력합니다.',
          screenHref: '/admin/catalog/policies',
          detail: [
            '대상 굿즈를 비우면 그 IP 굿즈 결제 합계 기준으로 적용됩니다.',
            '발급 카드풀은 운영 가능 상태의 풀만 선택할 수 있습니다.',
          ],
        },
        { text: '활성 체크박스를 켜고 저장합니다. 운영 예정·운영 중·종료 상태는 기간에 따라 표시됩니다.' },
      ],
      callouts: [
        {
          tone: 'info',
          title: '정책은 중복 적용됩니다',
          body: [
            '한 주문이 여러 정책의 조건을 동시에 충족하면 해당 정책의 카드팩이 모두 지급됩니다. 새 정책을 켜기 전에 기존 활성 정책과 겹치는지 확인해주세요.',
          ],
        },
        {
          tone: 'warning',
          title: '발급 이력이 생긴 정책의 풀은 못 바꿉니다',
          body: [
            '이미 이 정책으로 카드팩이 발급됐다면 발급 카드풀을 변경할 수 없습니다. 풀을 바꾸려면 정책을 비활성화하고 새 정책을 만드세요.',
          ],
        },
      ],
      screens: [{ href: '/admin/catalog/policies' }],
    },
    {
      id: 'grants',
      heading: '카드팩 수동 발급',
      paragraphs: [
        '이벤트 보상·CS 보상 등으로 특정 회원에게 카드팩을 직접 지급할 때 씁니다.',
      ],
      steps: [
        { text: '카드팩 수동 발급 화면에서 이메일·닉네임으로 회원을 검색해 대상을 선택합니다.', screenHref: '/admin/catalog/grants' },
        {
          text: `발급 카드풀, 발급 수량(1~${DRAW_TICKET_GRANT_MAX_QUANTITY}개), 발급 사유를 입력하고 발급합니다.`,
          detail: ['최근 수동 발급 이력이 화면 아래에 남습니다.'],
        },
      ],
      screens: [{ href: '/admin/catalog/grants' }],
    },
    {
      id: 'games',
      heading: '참여형 게임',
      paragraphs: [
        '참여형 게임은 웹에서 무료로 플레이하고 서버가 보상을 확정하는 게임입니다. 신규 등록은 카드 보상형만 가능합니다.',
        '과거에 쓰던 굿즈 보상형(goods variant) 게임은 읽기 전용 기록으로만 남아 있습니다 — 목록에서 열어 볼 수는 있지만 수정·신규 등록은 되지 않습니다.',
      ],
      steps: [
        {
          text: '게임 화면에서 게임 주소 이름(영문 소문자), 제목, 보상 카드풀, 사용자별 일일 플레이 한도(1~100), 운영 시작(KST)을 입력합니다.',
          screenHref: '/admin/catalog/games',
          detail: [
            '게임 운영 기간은 보상 카드풀의 운영 기간 안에 들어가야 합니다.',
            '이벤트 연결은 선택이며, 같은 IP의 온라인 이벤트만 연결할 수 있습니다.',
          ],
        },
        { text: '운영을 끝낼 때는 게임 종료 처리를 합니다.' },
      ],
      callouts: [
        {
          tone: 'warning',
          title: '첫 플레이 이후 잠금',
          body: [
            '플레이 이력이 생기면 게임 주소 이름·보상 카드풀·연결 이벤트·설정이 잠깁니다. 오픈 전에 충분히 확인해주세요.',
          ],
        },
      ],
      screens: [{ href: '/admin/catalog/games' }],
    },
  ],
};
