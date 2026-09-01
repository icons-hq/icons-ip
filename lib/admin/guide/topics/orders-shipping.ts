import { ADMIN_DISPATCH_DELAY_DAYS } from '@/lib/admin/dispatch';
import { ADMIN_ORDER_STATUS_LABELS } from '@/lib/admin/orders';
import { TRACKING_IMPORT_ROW_LIMIT, TRACKING_IMPORT_SAMPLE } from '@/lib/admin/tracking-import';
import type { AdminGuideTopic } from '../types';

/* 상태 표기는 주문 콘솔과 같은 진실원(ADMIN_ORDER_STATUS_LABELS)에서 파생한다. */
const L = ADMIN_ORDER_STATUS_LABELS;

export const ORDERS_SHIPPING_TOPIC: AdminGuideTopic = {
  slug: 'orders-shipping',
  title: '주문 처리와 발송',
  navLabel: '주문·발송',
  summary: `주문 사다리 7단계와 운영자가 미는 3개의 전이 — ${L.paid} 확인부터 발송, 배송완료, 자동 거래확정까지의 절차입니다.`,
  sections: [
    {
      id: 'ladder',
      heading: '주문 사다리 한눈에 보기',
      paragraphs: [
        '주문은 아래 순서로만 앞으로 갑니다(주문 사다리). 운영자가 화면에서 직접 미는 전이는 세 개뿐이고, 나머지는 시스템이 소유합니다.',
      ],
      table: {
        columns: ['상태', '뜻', '다음 단계로 미는 주체'],
        rows: [
          [L.pending, '결제가 아직 확정되지 않은 주문(무통장 입금 대기 포함)', '결제 확정 시스템 · 무통장은 입금 확인'],
          [L.paid, '결제가 끝나 발송을 기다리는 주문', `운영자가 ${L.confirmed} 처리`],
          [L.confirmed, '운영자가 주문을 인지하고 준비를 시작한 상태', '운영자가 발송처리'],
          [L.shipping, '운송장이 등록되어 배송 중', '운영자가 배송완료 처리'],
          [L.delivered, '고객이 굿즈를 받은 상태 — 청약철회 기한이 시작됨', '8일 뒤 자동 거래확정'],
          [L.done, '거래가 종결된 상태', '(종료)'],
          [L.canceled, '취소된 주문', '클레임 처리·미입금 취소 경로가 만듦'],
        ],
      },
      callouts: [
        {
          tone: 'info',
          title: '전이가 거절되는 경우',
          body: [
            '진행 중인 클레임이 열려 있는 주문은 상태를 앞으로 밀 수 없습니다. 클레임을 먼저 종결해주세요.',
            '순서를 건너뛰는 전이(예: 신규주문에서 바로 배송완료)는 허용되지 않습니다.',
          ],
        },
      ],
      screens: [{ href: '/admin/sales/orders' }],
    },
    {
      id: 'dispatch',
      heading: '신규주문 확인(발주확인)',
      paragraphs: [
        `발주·발송 관리 화면은 세 탭으로 나뉩니다 — ${L.paid}(발주확인 대기), 발송 대기(발주확인 완료), 발송지연(발주확인 후 ${ADMIN_DISPATCH_DELAY_DAYS}일 경과).`,
      ],
      steps: [
        { text: '발주·발송 관리의 신규주문 탭을 엽니다.', screenHref: '/admin/sales/dispatch' },
        { text: '준비를 시작할 주문을 체크하고 일괄 발주확인을 누릅니다. 한 번에 100건까지 처리됩니다.' },
        {
          text: '결과를 확인합니다.',
          detail: [
            '실패한 건은 주문번호와 사유가 함께 표시되므로 해당 주문만 다시 확인하면 됩니다.',
            '목록의 "결제사" 칸은 결제대행사(토스페이먼츠·Korpay)이지 카드/무통장 같은 결제수단이 아닙니다.',
          ],
        },
      ],
      screens: [{ href: '/admin/sales/dispatch' }],
    },
    {
      id: 'ship',
      heading: '발송처리와 운송장 입력',
      paragraphs: [
        '발송처리는 택배사와 운송장번호를 함께 등록하며 주문을 배송중으로 바꾸는 조작입니다. 발주·발송 관리의 발송 대기 탭에서 행별로 처리하거나, 주문 통합검색의 주문 상세에서 처리할 수 있습니다.',
      ],
      steps: [
        { text: '발송 대기 탭에서 주문을 찾습니다.', screenHref: '/admin/sales/dispatch' },
        {
          text: '택배사를 고르고 운송장번호를 입력합니다.',
          detail: [
            '택배사 목록에는 현재 계약 중인(활성) 택배사만 뜹니다. 새 택배사가 필요하면 개발팀에 등록을 요청합니다.',
            '운송장번호는 하이픈을 뺀 8~30자리 영숫자입니다. 하이픈·공백을 붙여넣어도 자동으로 정리됩니다.',
          ],
        },
        {
          text: '발송처리를 누르고 확인 창의 문구를 읽은 뒤 진행합니다.',
          detail: [
            '입력한 택배사·운송장번호는 고객의 주문 상세에 그대로 노출됩니다.',
            '발송처리가 되면 고객에게 배송 시작 메일이 자동 발송됩니다.',
          ],
        },
      ],
      callouts: [
        {
          tone: 'warning',
          title: '운송장의 기준은 창고 WMS입니다',
          body: [
            '어드민의 운송장은 창고 WMS가 발행한 값을 옮겨 적는 운영 기록입니다. 값이 어긋나면 WMS가 기준입니다. 임의의 번호를 만들어 넣지 마세요.',
          ],
        },
      ],
      screens: [{ href: '/admin/sales/dispatch' }, { href: '/admin/sales/orders' }],
    },
    {
      id: 'bulk-tracking',
      heading: '엑셀 일괄 운송장 등록',
      paragraphs: [
        '발송 건이 많을 때는 발송 대기·발송지연 탭 상단의 "엑셀 일괄 운송장 등록" 패널을 씁니다. 엑셀에서 세 칸을 복사해 붙여넣거나 CSV 파일을 올립니다.',
      ],
      steps: [
        {
          text: '엑셀에서 주문번호·택배사코드·운송장번호 세 칸을 준비합니다.',
          detail: [
            `형식 예시 — ${TRACKING_IMPORT_SAMPLE.split('\n').join(' / ')}`,
            '주문번호는 콘솔에 표시되는 8자리를 그대로 쓰면 됩니다.',
            '택배사 칸은 코드(hanjin)와 화면 표시명(한진택배) 둘 다 인식합니다.',
          ],
        },
        { text: `붙여넣기 또는 파일 업로드로 제출합니다. 한 번에 ${TRACKING_IMPORT_ROW_LIMIT}건까지 처리됩니다.` },
        { text: '실패 목록을 확인합니다. 줄 번호·주문번호·사유가 함께 표시됩니다.' },
      ],
      list: [
        `${L.confirmed} 상태가 아닌 주문은 실패합니다 — 실패 사유에 현재 상태가 적혀 나옵니다. 발주확인을 먼저 해주세요.`,
        '같은 주문번호가 두 줄이면 나중 줄이 거절됩니다 — 어느 값이 맞는지 파일에서 정리한 뒤 다시 올립니다.',
        '계약이 끝난(비활성) 택배사 코드는 거절됩니다.',
      ],
      screens: [{ href: '/admin/sales/dispatch' }],
    },
    {
      id: 'delay',
      heading: '발송지연 관리',
      paragraphs: [
        `발주확인 후 ${ADMIN_DISPATCH_DELAY_DAYS}일이 지나도 발송되지 않은 주문은 발송지연 탭에 모입니다. 지연은 별도의 주문 상태가 아니라 운영 메모입니다 — 발송처리를 하면 자연히 목록에서 빠집니다.`,
        '지연 사유와 발송 예정일을 메모로 남길 수 있습니다. 이 메모는 구매자에게 보이지 않는 내부 기록이며, 사유를 비우고 저장하면 메모가 삭제됩니다.',
      ],
      callouts: [
        {
          tone: 'warning',
          title: '발송 예정일은 모르면 비워 둡니다',
          body: [
            '지어낸 날짜는 CS 응대에서 그대로 고객 약속이 됩니다. 확실하지 않으면 사유만 적고 날짜는 비워 두세요.',
          ],
        },
      ],
      screens: [{ href: '/admin/sales/dispatch' }],
    },
    {
      id: 'delivered',
      heading: '배송완료 처리와 거래확정',
      paragraphs: [
        '배송현황 관리 화면의 배송중 탭에서 도착이 확인된 주문을 배송완료로 처리합니다. 배송완료 탭은 조회 전용이며, 배송완료를 되돌리는 전이는 없습니다.',
        '배송완료 시점부터 고객의 청약철회 기한이 시작됩니다. 처리 전 확인 창이 이 사실을 다시 알려줍니다.',
        `${L.delivered} 후 8일이 지나면 시스템이 자동으로 ${L.done} 처리합니다. 거래확정 내역 화면은 조회 전용이며, 확정 이후에도 하자·오배송 클레임은 공급받은 날부터 3개월 이내에 접수될 수 있으므로 "확정됐으니 끝"이라고 안내하면 안 됩니다.`,
      ],
      screens: [{ href: '/admin/sales/shipping' }, { href: '/admin/sales/settled' }],
    },
    {
      id: 'tracking-fix',
      heading: '운송장 수정',
      paragraphs: [
        '이미 발송처리된 주문의 택배사·운송장번호를 고칠 때는 주문 통합검색에서 주문을 열고 운송장 수정 전용 폼을 씁니다. 주문 상태는 그대로 두고 운송장만 바뀌며, 배송중·배송완료·거래확정 상태에서만 가능합니다.',
        '발주확인이나 배송완료 처리 화면에서는 운송장을 입력받지 않습니다 — 운송장이 조용히 바뀌는 경로를 막기 위해 수정은 전용 폼으로만 엽니다.',
      ],
      screens: [{ href: '/admin/sales/orders' }],
    },
  ],
};
