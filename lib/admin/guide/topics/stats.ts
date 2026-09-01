import type { AdminGuideTopic } from '../types';

export const STATS_TOPIC: AdminGuideTopic = {
  slug: 'stats',
  title: '대시보드와 통계 읽는 법',
  navLabel: '통계',
  summary: '개요 대시보드와 통계 3개 화면(판매분석·클레임·고객현황)이 무엇을 보여주는지 정리합니다. 모두 조회 전용입니다.',
  sections: [
    {
      id: 'overview-dash',
      heading: '개요 대시보드',
      paragraphs: [
        '어드민에 들어오면 처음 보이는 화면입니다. "지금 어떤가"를 한눈에 보는 자리이고, 깊게 파고드는 것은 통계 화면의 몫입니다.',
      ],
      list: [
        '지표 카드 4개 — 최근 30일 매출·결제 건수·평균 결제액·신규 가입. 증감 표시는 이전 30일 대비입니다.',
        '매출 추이 차트와 주문 파이프라인 — 파이프라인은 상태별로 지금 몇 건이 걸려 있는지 보여줍니다. 신규주문·발송지연이 쌓이면 발주·발송 관리로 이동해 처리합니다.',
        '최근 주문 / TOP IP / 최근 신고 5건 — 각 카드의 링크로 해당 콘솔에 바로 들어갑니다.',
      ],
      screens: [{ href: '/admin' }],
    },
    {
      id: 'sales',
      heading: '판매분석',
      paragraphs: [
        '일자별(한국 시간 기준) 주문 수와 객단가, 굿즈별 판매 순위, 결제수단 비중을 봅니다. 이벤트 예매는 이벤트별·회차별 건수와 티켓 수로 따로 집계됩니다.',
        '상단 기간 탭으로 조회 범위를 바꿉니다. 화면에 보이는 것 이상의 내려받기(CSV)나 임의 기간 지정은 아직 없습니다.',
      ],
      screens: [{ href: '/admin/stats/sales' }],
    },
    {
      id: 'claims-stats',
      heading: '클레임 통계',
      paragraphs: [
        '유형별(취소·반품·교환) 접수 추이와 주문 1,000건당 클레임 비율, 현재 진행 중인 건수를 봅니다. 비율이 갑자기 오르면 특정 굿즈의 품질·배송 문제 신호일 수 있으니 클레임 목록에서 사유를 확인해주세요.',
      ],
      screens: [{ href: '/admin/stats/claims' }],
    },
    {
      id: 'customers',
      heading: '고객현황',
      paragraphs: [
        '일자별 신규 가입 추이와 문의·리뷰 흐름을 봅니다.',
      ],
      screens: [{ href: '/admin/stats/customers' }],
    },
  ],
};
