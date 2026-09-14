import type { AdminGoodSummary } from '../../lib/admin/goods-list';
import type { GoodsOptionRow } from '../../lib/admin/goods-option-editor';

export const FIXTURE_IPS = [
  { id: 'ip-maple-long-title', title: '서울 한정 메이플스토리 캐릭터 아크릴 스탠드와 겨울 시즌 장식 컬렉션', archivedAt: null },
  { id: 'ip-hyosan-memory', title: '효산고등학교 기억의 조각 — 장문 IP 이름 레이아웃 검수용', archivedAt: null },
  { id: 'ip-archived-sample', title: '보관된 IP · 필터 select 전체 폭 확인용', archivedAt: '2026-08-01T00:00:00Z' },
];

const names = [
  '서울 한정 메이플스토리 캐릭터 아크릴 스탠드 — 크림화이트 겨울 에디션',
  '효산고등학교 기억의 조각 포토카드 보관 바인더 — 긴 상품명 샘플',
  '한정판 교복 자수 패치 세트와 미니 포스터 패키지',
  '장문 옵션명과 ERP 품명 간격을 확인하는 검수용 상품',
  '팬덤 기록용 투명 PVC 파우치 · 캠페인 운영 샘플',
  '운영자 화면 수평 스크롤 확인용 아주 긴 굿즈 상품 제목 샘플',
];

export const FIXTURE_GOODS: AdminGoodSummary[] = names.map((name, index) => ({
  id: `fixture-good-${String(index + 1).padStart(2, '0')}`,
  code: `LONG-KR-GOODS-${String(index + 1).padStart(3, '0')}`,
  name,
  ipId: index % 2 ? 'ip-hyosan-memory' : 'ip-maple-long-title',
  ipTitle: index % 2 ? FIXTURE_IPS[1].title : FIXTURE_IPS[0].title,
  publishedAt: index % 3 === 0 ? null : '2026-09-01T00:00:00Z',
  archivedAt: index === 5 ? '2026-09-03T00:00:00Z' : null,
  stock: index === 4 ? 'low' : index === 5 ? 'soldout' : 'ok',
  stockQty: index === 4 ? 7 : index === 5 ? 0 : 50 + index * 13,
  activeStockQty: index === 4 ? 7 : index === 5 ? 0 : 42 + index * 9,
  saleAvailableQty: index === 5 ? 0 : 42 + index * 9,
  lowStockOptionCount: index === 4 ? 3 : 0,
  allowCardPayment: true,
  allowBankTransfer: true,
  saleRestriction: 'none',
  noticeComplete: index !== 4,
}));

export const FIXTURE_OPTION_ROWS: GoodsOptionRow[] = [
  {
    id: 'fixture-option-1',
    name: '크림화이트 / M — 장문 옵션명 편집 공간 확인용',
    code: 'LONG-KR-OPTION-01',
    attributes: { 색상: '크림화이트', 사이즈: 'M' },
    extraPrice: 0,
    stockQty: 10,
    expectedStockQty: 10,
    lowStockThreshold: 3,
    isActive: true,
    erpCode: 'ERP-000000000001',
    erpName: '메이플스토리 크림화이트 아크릴 스탠드 겨울 한정판 M 사이즈 외부 품명 샘플',
    barcode: '8800000000001',
    externalUpdatedAt: '2026-09-10T00:00:00Z',
  },
  {
    id: 'fixture-option-2',
    name: '딥네이비 / L',
    code: 'LONG-KR-OPTION-02',
    attributes: { 색상: '딥네이비', 사이즈: 'L' },
    extraPrice: 1800,
    stockQty: 2,
    expectedStockQty: 2,
    lowStockThreshold: 5,
    isActive: true,
    erpCode: 'ERP-000000000002',
    erpName: '효산고등학교 기억의 조각 딥네이비 L 외부 연동 품명',
    barcode: '8800000000002',
    externalUpdatedAt: '2026-09-10T00:00:00Z',
  },
];
