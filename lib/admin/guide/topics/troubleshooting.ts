import type { AdminGuideErrorCase, AdminGuideTable, AdminGuideTopic } from '../types';

/*
 * quote는 화면에 뜨는 문구 원문이다. topics.test.ts가 sourceFile 소스에 이 문자열이
 * 실재하는지 대조하므로, 코드의 문구가 바뀌면 이 표가 유령 문구를 인용하는 순간
 * 테스트가 깨진다 — 표를 고칠 때는 반드시 화면 문구를 그대로 옮겨 적는다.
 */

const CATALOG_CASES: AdminGuideErrorCase[] = [
  {
    quote: '이미 사용 중인 ID입니다. 수정하려면 목록에서 선택해주세요.',
    sourceFile: 'app/admin/actions.ts',
    cause: '빈 폼(신규 등록)에 기존 항목의 ID를 직접 입력했습니다. 신규 등록이 기존 데이터를 덮어쓰는 사고를 막는 안전장치입니다.',
    fix: '왼쪽 목록에서 해당 항목을 선택해 수정 모드로 연 뒤 고칩니다. 새 항목이라면 다른 ID를 씁니다.',
  },
  {
    quote: '고시정보를 모두 입력한 뒤 저장해주세요.',
    sourceFile: 'app/admin/actions.ts',
    cause: '굿즈 고시정보 7개 항목 중 비어 있는 칸이 있습니다. 운영 상태만 바꾸는 저장에도 똑같이 적용됩니다.',
    fix: '고시정보 7칸을 전부 채우고 다시 저장합니다.',
  },
  {
    quote: '검증된 이미지를 다시 업로드한 뒤 저장해주세요.',
    sourceFile: 'app/admin/actions.ts',
    cause: '업로드 후 시간이 지났거나 업로드가 중간에 끊겨 이미지 검증 기록이 만료됐습니다.',
    fix: '이미지를 다시 업로드하고 바로 저장을 누릅니다.',
  },
];

const STOCK_CASES: AdminGuideErrorCase[] = [
  {
    quote: '실재고가 변경되었습니다. 최신 수량을 확인한 뒤 다시 시도해주세요.',
    sourceFile: 'app/admin/actions.ts',
    cause: '입력하는 사이 다른 운영자의 조정이나 고객 주문으로 수량이 먼저 바뀌었습니다.',
    fix: '화면에 갱신된 현재 수량을 확인하고 조정 수량을 다시 입력합니다.',
  },
  {
    quote: '재고는 0개 미만이거나 허용 범위를 넘도록 조정할 수 없습니다.',
    sourceFile: 'app/admin/actions.ts',
    cause: '차감량이 현재 수량보다 커서 결과가 음수가 되거나, 허용 범위를 벗어났습니다.',
    fix: '현재 수량을 확인하고 결과가 0 이상이 되도록 조정량을 줄입니다.',
  },
];

const ORDER_CASES: AdminGuideErrorCase[] = [
  {
    quote: '주문 상태를 변경하지 못했습니다. 최신 상태를 확인해주세요.',
    sourceFile: 'app/admin/order-actions.ts',
    cause: '다른 운영자가 먼저 처리했거나, 진행 중인 클레임이 열려 있거나, 사다리 순서에 맞지 않는 전이를 시도했습니다.',
    fix: '새로고침으로 현재 상태를 확인합니다. 클레임이 열려 있으면 클레임을 먼저 종결합니다.',
  },
  {
    quote: '운송장번호는 하이픈을 뺀 8~30자리 영숫자여야 합니다.',
    sourceFile: 'lib/admin/orders.ts',
    cause: '운송장번호 형식이 규칙에 맞지 않습니다.',
    fix: 'WMS가 발행한 운송장번호를 다시 확인해 붙여넣습니다. 하이픈·공백은 자동으로 정리됩니다.',
  },
];

const BANK_CASES: AdminGuideErrorCase[] = [
  {
    quote: '기한 연장은 주문당 한 번입니다. 더 기다릴 수 없다면 취소해주세요.',
    sourceFile: 'app/admin/unpaid-actions.ts',
    cause: '이미 한 번 연장한 무통장 주문을 다시 연장하려 했습니다.',
    fix: '추가 연장은 없습니다. 입금을 더 기다릴 수 없으면 사유를 남기고 즉시 취소합니다.',
  },
];

const ARCHIVE_CASES: AdminGuideErrorCase[] = [
  {
    quote: '판매 가능한 재고가 남아 있어 굿즈를 보관할 수 없습니다.',
    sourceFile: 'app/admin/archive-actions.ts',
    cause: '실재고 수량이 남은 굿즈를 보관하려 했습니다.',
    fix: '실재고 조정으로 수량을 0으로 만든 뒤(사유: 보관 전 정리 등) 다시 보관합니다.',
  },
  {
    quote: '활성 리워드 정책에 연결된 굿즈는 보관할 수 없습니다.',
    sourceFile: 'app/admin/archive-actions.ts',
    cause: '활성 상태의 카드팩 발급 정책이 이 굿즈를 대상으로 잡고 있습니다.',
    fix: '발급 정책 화면에서 해당 정책을 비활성화한 뒤 보관합니다.',
  },
];

const CLAIM_CASES: AdminGuideErrorCase[] = [
  {
    quote: '결제 취소 정합화가 끝나지 않았습니다. 재고 복원과 카드팩 회수가 확인된 뒤에만 환불 완료를 기록할 수 있습니다.',
    sourceFile: 'app/admin/claim-actions.ts',
    cause: '결제사 취소가 아직 시스템에서 확인되지 않은 상태에서 환불 완료를 먼저 기록하려 했습니다.',
    fix: '화면의 결제 취소 확인 절차를 먼저 마칩니다. Korpay 건의 수동 확정은 admin에게 요청합니다.',
  },
  {
    quote: '이 클레임에는 등록된 환불계좌가 없습니다. 계좌 송금 대신 결제사 취소로 접수하거나, 구매자에게 계좌를 먼저 받아주세요.',
    sourceFile: 'app/admin/claim-actions.ts',
    cause: '환불 수단을 계좌 송금으로 골랐지만 구매자의 환불계좌가 등록되어 있지 않습니다.',
    fix: '카드 결제 건이면 결제사 취소로 접수합니다. 계좌 송금이 맞으면 구매자에게 환불계좌를 받은 뒤 진행합니다.',
  },
  {
    quote: '처리에 착수한 클레임은 거부할 수 없습니다. 결제 취소를 마치거나, 사람이 판단할 일이면 보류로 남겨주세요.',
    sourceFile: 'app/admin/claim-actions.ts',
    cause: '환불 처리가 시작된 클레임을 거부하려 했습니다.',
    fix: '시작한 결제 취소를 끝까지 진행하거나, 판단 보류가 필요하면 보류로 전환합니다.',
  },
  {
    quote: '청약철회 기한이 지난 요청입니다. 승인 대신 사유를 남겨 거부해주세요.',
    sourceFile: 'app/admin/claim-actions.ts',
    cause: '법정 청약철회 기한이 지난 접수 건을 승인하려 했습니다.',
    fix: '기한 경과를 사유(10~200자)로 적어 거부 처리합니다. 사유는 구매자에게 전달됩니다.',
  },
];

const PROMOTION_CASES: AdminGuideErrorCase[] = [
  {
    quote: '이미 사용 중인 코드입니다. 수정하려면 목록에서 선택해주세요.',
    sourceFile: 'app/admin/coupon-actions.ts',
    cause: '빈 폼(신규 등록)에 기존 쿠폰의 코드를 직접 입력했습니다.',
    fix: '왼쪽 목록에서 해당 쿠폰을 선택해 수정 모드로 연 뒤 고칩니다. 새 쿠폰이라면 다른 코드를 씁니다.',
  },
  {
    quote: '쿠폰 섹션의 코드가 쿠폰 관리에 등록되어 있지 않아요.',
    sourceFile: 'app/admin/campaign-actions.ts',
    cause: '캠페인 랜딩 구성의 쿠폰 블록에 아직 등록되지 않은 쿠폰 코드를 넣었습니다.',
    fix: '쿠폰 관리에서 그 코드를 먼저 등록한 뒤 캠페인을 저장합니다.',
  },
];

const POOL_CASES: AdminGuideErrorCase[] = [
  {
    quote: '확률 합계는 100%여야 합니다.',
    sourceFile: 'lib/admin/catalog.ts',
    cause: '카드풀 등급별 확률 다섯 칸의 합이 100%가 아닙니다.',
    fix: '다섯 등급의 확률을 다시 배분해 합계를 정확히 100%로 맞춥니다. 소수 셋째 자리까지 입력할 수 있습니다.',
  },
];

export const ADMIN_GUIDE_ERROR_CASES: AdminGuideErrorCase[] = [
  ...CATALOG_CASES,
  ...STOCK_CASES,
  ...ORDER_CASES,
  ...BANK_CASES,
  ...ARCHIVE_CASES,
  ...CLAIM_CASES,
  ...PROMOTION_CASES,
  ...POOL_CASES,
];

function errorTable(cases: AdminGuideErrorCase[]): AdminGuideTable {
  return {
    columns: ['화면 문구', '왜 생기나', '이렇게 해결'],
    rows: cases.map((item) => [item.quote, item.cause, item.fix]),
  };
}

export const TROUBLESHOOTING_TOPIC: AdminGuideTopic = {
  slug: 'troubleshooting',
  title: '자주 만나는 오류와 해결',
  navLabel: '오류 해결',
  summary: '화면에 실제로 뜨는 오류 문구를 그대로 모아, 원인과 해결 방법을 정리했습니다.',
  sections: [
    {
      id: 'how-to-read',
      heading: '오류가 표시되는 방식',
      paragraphs: [
        '어드민의 오류는 팝업이 아니라 폼 안에 표시됩니다 — 문제가 된 입력 칸 바로 아래, 또는 폼 상단의 알림 카드를 확인해주세요.',
        '"최신 상태를 확인해주세요"로 끝나는 문구는 대부분 다른 운영자·고객의 처리가 먼저 반영된 경우입니다. 새로고침해서 현재 상태를 보고 다시 시도하면 해결됩니다.',
        '아래 표의 문구는 화면에 뜨는 원문 그대로입니다. 표에 없는 오류가 반복되면 문구를 그대로 복사해 개발팀에 전달해주세요.',
      ],
    },
    { id: 'catalog', heading: '카탈로그 등록·이미지', table: errorTable(CATALOG_CASES) },
    { id: 'stock', heading: '실재고 조정', table: errorTable(STOCK_CASES) },
    { id: 'orders', heading: '주문·배송', table: errorTable(ORDER_CASES) },
    { id: 'bank', heading: '무통장 입금', table: errorTable(BANK_CASES) },
    { id: 'archive', heading: '보관', table: errorTable(ARCHIVE_CASES) },
    { id: 'claims', heading: '클레임', table: errorTable(CLAIM_CASES) },
    { id: 'promotions', heading: '쿠폰·캠페인', table: errorTable(PROMOTION_CASES) },
    { id: 'pools', heading: '카드풀', table: errorTable(POOL_CASES) },
  ],
};
