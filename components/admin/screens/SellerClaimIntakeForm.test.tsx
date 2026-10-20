import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { SellerClaimIntakeForm } from './SellerClaimIntakeForm';
import { SellerClaimIntakeEvidence } from './SellerClaimIntakeEvidence';
import { sellerClaimContextFixture, sellerClaimReceiptFixture } from '@/lib/admin/seller-claim-intake.fixture';
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/app/admin/seller-claim-intake-actions', () => ({ loadSellerClaimContextAction: vi.fn(), readSellerClaimIntakeAction: vi.fn(), submitSellerClaimIntakeAction: vi.fn() }));
describe('판매자 반품·교환 접수 화면', () => {
  it('발주 전 취소는 수거 입력 없이 고객 요청과 승인 이후 처리를 구분한다', () => {
    const context = { ...sellerClaimContextFixture, orderStatus: 'paid', deliveredAt: null, cancelBlockedReason: null };
    const html = renderToStaticMarkup(<SellerClaimIntakeForm context={context} carriers={context.carriers} onClose={() => {}} />);
    expect(html).toContain('판매자 직접 취소 접수');
    expect(html).toContain('취소 · 주문 전체');
    expect(html).toContain('고객 합의 근거');
    expect(html).toContain('승인과 결제 취소·환급은 접수 후 별도로');
    expect(html).not.toContain('<legend>수거 주소</legend>');
    expect(html).not.toContain('출고지별 수거 계획');
    expect(html).not.toContain('반품 · 주문 전체');
    expect(html).toContain('disabled="">취소 요청 접수');
    const evidence = renderToStaticMarkup(<SellerClaimIntakeEvidence intake={{ ...sellerClaimReceiptFixture, claimType: 'cancel', collectionAddress: null, collections: [] }} />);
    expect(evidence).toContain('주문 전체 취소의 접수 근거');
    expect(evidence).not.toContain('수거 안내 주소');
  });
  it('제공된 디지털 파일은 교환이나 가상 수거 대신 취소 심사로 접수한다', () => {
    const context = { ...sellerClaimContextFixture, digitalExchangeBlocked: true, cancelBlockedReason: null, collections: [] };
    const html = renderToStaticMarkup(<SellerClaimIntakeForm context={context} carriers={context.carriers} onClose={() => {}} />);
    expect(html).toContain('취소 · 주문 전체');
    expect(html).toContain('재다운로드 및 문의·취소·환불 심사');
    expect(html).not.toContain('교환 · 주문 전체');
    expect(html).not.toContain('<legend>수거 주소</legend>');
  });
  it('주문 전체·고객 동의·수거 계획을 구분하고 승인·환급 버튼을 만들지 않는다', () => {
    const html = renderToStaticMarkup(<SellerClaimIntakeForm context={sellerClaimContextFixture} carriers={sellerClaimContextFixture.carriers} onClose={() => {}} />);
    for (const text of ['반품 · 주문 전체','교환 · 주문 전체','고객 합의 근거','고객 요청 시각 (한국 시간)','수거 주소','합성 출고지','접수 후 수거 협의','환불계좌 (선택)','반품 요청 접수']) expect(html).toContain(text);
    expect(html).not.toContain('name="amount"'); expect(html).not.toContain('자동수거요청'); expect(html).not.toContain('>환불 승인<');
    expect(html).toContain('disabled="">반품 요청 접수');
  });
  it('서버가 접수를 막은 상태는 배정·수령 확인 사유를 보여준다', () => {
    const html = renderToStaticMarkup(<SellerClaimIntakeForm context={{ ...sellerClaimContextFixture, blockedReasons: { change_of_mind: 'not_claimable', defect: 'not_claimable' } }} carriers={sellerClaimContextFixture.carriers} onClose={() => {}} />);
    expect(html).toContain('전체 수량의 배송 배정과 이전 교환품의 수령 상태');
  });
  it('상세에서 실제 담당자·고객 요청시각·출고지별 계획을 읽는다', () => {
    const html = renderToStaticMarkup(<SellerClaimIntakeEvidence intake={sellerClaimReceiptFixture} />);
    expect(html).toContain('합성 담당자'); expect(html).toContain('전화 상담'); expect(html).toContain('접수 기한 소급 없음');
    expect(html).toContain('합성 주문 상품 2개'); expect(html).toContain('실제 입고 확인을 별도로');
  });
});
