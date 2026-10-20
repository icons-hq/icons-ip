import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { PurchaseRestrictionBatchForm } from './PurchaseRestrictionBatchForm';
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/app/admin/purchase-restriction-batch-actions', () => ({ previewPurchaseRestrictionBatchAction: vi.fn(), executePurchaseRestrictionBatchAction: vi.fn(), readPurchaseRestrictionBatchAction: vi.fn() }));
describe('복수 고객 등록 화면', () => {
  it('원본의 복수 입력·등록 사유를 대상 확인으로 연결하며 파일 업로드를 꾸미지 않는다', () => {
    const html = renderToStaticMarkup(<PurchaseRestrictionBatchForm currentHref="/admin/sales/purchase-restrictions?state=active" />);
    expect(html).toContain('최대 100개'); expect(html).toContain('줄바꿈이나 쉼표'); expect(html).toContain('전체 주문번호');
    expect(html).toContain('등록 대상 확인'); expect(html).toContain('공통 상세 사유'); expect(html).not.toContain('type="file"');
    expect(html).not.toContain('구매제한 등록</button>');
  });
  it('미리보기에서 제외 사유와 명시 확인·결과 재조회·다시 열기를 제공한다', () => {
    const html = renderToStaticMarkup(<PurchaseRestrictionBatchForm currentHref="/admin/sales/purchase-restrictions?state=active" initialBatch={{
      id: '00000000-0000-4000-8000-000000063521', mode: 'customer', reasonCode: 'other', reasonDetail: '확인 근거', createdAt: '2026-10-12T00:00:00Z', expiresAt: '2026-10-12T00:15:00Z', completedAt: null, status: 'prepared', canExecute: true, readyCount: 0, registeredCount: 0, skippedCount: 0, failedCount: 0,
      rows: [{ rowNumber: 1, input: 'missing@example.test', userId: null, nickname: null, maskedEmail: null, evidenceOrderId: null, status: 'not_found', duplicateOf: null, restrictionId: null, outcome: null, error: null, currentState: null, releasedAt: null }],
    }} />);
    expect(html).toContain('조회되지 않음'); expect(html).toContain('등록 결과 재조회'); expect(html).toContain('이 요청 다시 열기');
    expect(html).toContain('신규 상품 주문만 제한'); expect(html).toContain('disabled="">등록 가능 0명 구매제한 등록');
  });
});
