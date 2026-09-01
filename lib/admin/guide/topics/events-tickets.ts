import type { AdminGuideTopic } from '../types';

export const EVENTS_TICKETS_TOPIC: AdminGuideTopic = {
  slug: 'events-tickets',
  title: '이벤트·티켓·현장 검표',
  navLabel: '이벤트·티켓',
  summary: '팝업·이벤트 등록, 회차와 정원 관리, 현장 검표 화면 사용법입니다.',
  sections: [
    {
      id: 'events',
      heading: '이벤트 등록',
      steps: [
        {
          text: '이벤트 화면에서 필수 항목을 채웁니다 — ID(영문 소문자), 이벤트 이름, 모드(오프라인/온라인), 상태(예정·예매중·진행중·종료).',
          screenHref: '/admin/catalog/events',
          detail: [
            '연결 IP는 선택입니다. 비워 두면 플랫폼/합동 이벤트로 취급됩니다.',
            '시작·종료 시각은 한국 시간(KST)으로 입력합니다.',
            '장소·액센트 색상·아트워크(16:9)는 선택 항목입니다.',
          ],
        },
        { text: '저장 후 상태 값으로 예매중 전환 등을 관리합니다.' },
      ],
      callouts: [
        {
          tone: 'warning',
          title: '게임이 연결된 이벤트의 잠금',
          body: [
            '참여형 게임에 연결된 이벤트는 IP와 모드를 바꿀 수 없습니다. 게임 쪽 계약이 이벤트에 걸려 있기 때문입니다.',
          ],
        },
      ],
      screens: [{ href: '/admin/catalog/events' }],
    },
    {
      id: 'ticket-types',
      heading: '티켓 회차와 정원',
      paragraphs: [
        '회차는 한 이벤트 안의 판매 단위(시간대·종류)입니다. 회차마다 가격과 정원을 갖고, 상단 요약 배너에 할당/정원/잔여가 표시됩니다. 잔여 계산에는 결제 대기 중인 예매도 포함됩니다.',
      ],
      steps: [
        { text: '먼저 이벤트가 등록되어 있어야 합니다. 이벤트가 없으면 회차 저장 버튼이 비활성화됩니다.' },
        {
          text: '티켓 회차 화면에서 연결 이벤트, 회차명, 가격(원), 정원을 입력해 저장합니다.',
          screenHref: '/admin/catalog/ticket-types',
        },
        {
          text: '판매 중 조정은 정원만 가능합니다.',
          detail: [
            '예매 이력이 생기면 이벤트·회차명·가격은 잠기고, 정원은 현재 할당 수량 이상으로만 조정할 수 있습니다.',
            '정원을 0으로 두면 그 회차는 판매되지 않습니다.',
          ],
        },
      ],
      callouts: [
        {
          tone: 'info',
          title: '예매는 어드민에서 만들 수 없습니다',
          body: [
            '예매·발권은 고객 결제 경로로만 생성됩니다. 초대권처럼 결제 없는 입장은 현장 명단 등 별도 운영으로 처리해야 합니다.',
            '회차별 판매 실적은 통계의 판매분석에서 확인합니다.',
          ],
        },
      ],
      screens: [{ href: '/admin/catalog/ticket-types' }, { href: '/admin/stats/sales' }],
    },
    {
      id: 'check-in',
      heading: '현장 검표',
      paragraphs: [
        '검표 화면은 사이드바 없는 전체 화면으로 열립니다 — 현장 태블릿·모바일에서 쓰는 화면입니다. 티켓 회차 화면 상단의 "현장 검표 화면 열기" 버튼으로도 진입할 수 있습니다.',
        '입장 QR을 카메라로 스캔하거나, USB·블루투스 스캐너로 코드를 입력해 검표합니다. 입력값은 제출 즉시 화면에서 지워지며 저장되지 않습니다.',
      ],
      list: [
        '검표 완료 — 정상 입장 처리된 티켓입니다.',
        '이미 검표된 티켓 — 최초 검표 시각이 함께 표시됩니다. 중복 입장 시도인지 확인해주세요.',
        '환불된 티켓 / 취소·환불 확인 중인 티켓 — 입장에 사용할 수 없습니다.',
      ],
      screens: [{ href: '/admin/check-in' }, { href: '/admin/catalog/ticket-types' }],
    },
  ],
};
