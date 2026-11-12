import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/app/orders/claim-collection-actions', () => ({ readClaimCollectionAction: vi.fn(), saveClaimCollectionAction: vi.fn() }));
import { ClaimReturnBundles } from './ClaimCollectionPlan';
import type { ClaimCollectionRow } from '@/lib/orders/claim-collection';

const row: ClaimCollectionRow = { shipmentId: '00000000-0000-4000-8000-000000000003', originName: 'TEST 김포', revision: 0, method: 'not_requested', carrier: null,
  trackingNumber: null, evidence: '', requestedOnce: true, collectedAt: null, updatedAt: null };
const seoul = { bundleId: '00000000-0000-4000-8000-000000000010', returnName: '서울 반품지', returnAddress: '서울특별시 합성구 반품로 1', returnPhone: '02-1234-5678',
  items: [{ name: 'TEST 서울 굿즈', qty: 1 }], collectedAt: null };
const origin = { bundleId: '00000000-0000-4000-8000-000000000011', returnName: '', returnAddress: '경기도 합성시 출고지 반품로 2', returnPhone: '',
  items: [{ name: 'TEST 출고지 굿즈', qty: 2 }], collectedAt: '2026-11-12T01:00:00.000Z' };

/* S36-040·QNA-031: 승인 뒤 고객 반품 진행 칸에 배송 묶음별 회수 주소가 보인다. */
describe('ClaimReturnBundles', () => {
  it('한 배송 묶음이 두 반품지로 갈리면 나눠 보내라고 하고 묶음마다 주소·품목을 보인다', () => {
    const html = renderToStaticMarkup(<ClaimReturnBundles row={{ ...row, returnBundles: [origin, seoul] }} operator={false} />);
    expect(html).toContain('굿즈마다 보내는 곳이 달라 2곳으로 나눠 보내주세요.');
    expect(html).toContain('회수 주소 1/2');
    expect(html).toContain('<span>경기도 합성시 출고지 반품로 2</span>');
    expect(html).toContain('<span>서울 반품지 · 서울특별시 합성구 반품로 1 · 02-1234-5678</span>');
    expect(html).toContain('TEST 출고지 굿즈 2개');
    expect(html).toContain('입고 확인');
    /* 고객 화면은 출고지 이름을 말하지 않는다(R26). */
    expect(html).not.toContain('김포');
  });

  it('반품지가 하나면 나누라는 안내 없이 회수 주소 하나다', () => {
    const html = renderToStaticMarkup(<ClaimReturnBundles row={{ ...row, returnBundles: [seoul] }} operator={false} />);
    expect(html).not.toContain('나눠 보내주세요');
    expect(html).toContain('<small>회수 주소</small>');
  });

  it('승인 전(묶음 없음)에는 아무것도 그리지 않는다', () => {
    expect(renderToStaticMarkup(<ClaimReturnBundles row={row} operator={false} />)).toBe('');
  });

  /* 회수 생략(ADR-0041): 고객에게는 주소 대신 반송이 필요 없다고 말하고, 운영자는 주소를 계속 본다(늦은 도착 확인). */
  it('회수 생략 배송 건은 고객에게 주소 대신 반송이 필요 없다고 말한다', () => {
    const waived = { ...row, returnBundles: [seoul], collectionWaived: true as const };
    const customer = renderToStaticMarkup(<ClaimReturnBundles row={waived} operator={false} />);
    expect(customer).toContain('회수 없이 다시 보내드려요. 이 배송 묶음의 굿즈는 반송하지 않아도 됩니다.');
    expect(customer).not.toContain('서울특별시');
    const operator = renderToStaticMarkup(<ClaimReturnBundles row={waived} operator />);
    expect(operator).toContain('회수 생략으로 결정한 배송 건입니다.');
    expect(operator).toContain('서울특별시 합성구 반품로 1');
  });
});
