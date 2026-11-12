import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { DefectiveStockList } from '@/lib/admin/defective-stock';
import { DefectiveStockScreen } from './DefectiveStockScreen';

const CLAIM = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const list: DefectiveStockList = {
  variants: [{ goodId: 'g1', goodName: '아크릴 키링', variantId: 'v1', variantName: '파랑', variantCode: 'KR-01', qty: 3, entries: 2, lastRecordedAt: '2026-11-12T01:00:00Z' }],
  entries: [{ id: 'e1', claimId: CLAIM, claimReference: 12, orderItemId: 'oi1', goodName: '아크릴 키링', variantId: 'v1', variantName: '파랑', variantCode: 'KR-01', qty: 2, recordedAt: '2026-11-12T01:00:00Z', recordedByName: '김담당' }],
  pending: [],
};

describe('불량 재고 화면', () => {
  it('옵션별 합계와 근거 반품 요청 링크·처리자를 보인다', () => {
    const html = renderToStaticMarkup(<DefectiveStockScreen list={list} />);
    expect(html).toContain('data-admin-screen="defective-stock"');
    expect(html).toContain('판매 재고에는 들어 있지 않습니다');
    expect(html).toContain('옵션 1개 · 합계 3개');
    expect(html).toContain('파랑 (KR-01)');
    expect(html).toContain('3개');
    expect(html).toContain(`href="/admin/sales/claims/returns/${CLAIM}"`);
    expect(html).toContain('김담당');
    expect(html).not.toContain('불량 기록 필요');
  });

  it('기록이 없으면 빈 상태를, 기록 필요 클레임이 있으면 반품 상세로 안내한다', () => {
    const empty = renderToStaticMarkup(<DefectiveStockScreen list={{ variants: [], entries: [], pending: [] }} />);
    expect(empty).toContain('아직 기록된 불량 재고가 없습니다');
    const waiting = renderToStaticMarkup(<DefectiveStockScreen list={{ ...list, pending: [{ claimId: CLAIM, claimReference: 13, qty: 1, items: 1 }] }} />);
    expect(waiting).toContain('불량 기록 필요');
    expect(waiting).toContain('[불량 기록 다시 시도]');
    expect(waiting).toContain('반품 처리 권한이 있는 담당자');
    expect(waiting).toContain(`href="/admin/sales/claims/returns/${CLAIM}"`);
  });
});
