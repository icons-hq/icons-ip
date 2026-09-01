import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ANONYMOUS } from '@tosspayments/tosspayments-sdk';
import {
  TOSS_AGREEMENT_SELECTOR,
  TOSS_PAYMENT_METHODS_SELECTOR,
  TossWidgetCheckout,
  mountTossPaymentWidgets,
  parseTossCheckoutPayload,
} from './TossWidgetCheckout';

const sdk = vi.hoisted(() => ({
  loadTossPayments: vi.fn(),
  widgetsFactory: vi.fn(),
  setAmount: vi.fn(),
  renderPaymentMethods: vi.fn(),
  renderAgreement: vi.fn(),
  requestPayment: vi.fn(),
  paymentMethodsOn: vi.fn(),
  paymentMethodsDestroy: vi.fn(),
  agreementOn: vi.fn(),
  agreementDestroy: vi.fn(),
}));

/* 이 저장소에는 jsdom이 없다. SDK는 모듈 통째로 목으로 대체하고, 컴포넌트는
   renderToStaticMarkup으로 마크업만 단언한다(effect는 돌지 않는다). */
vi.mock('@tosspayments/tosspayments-sdk', () => ({
  ANONYMOUS: '@@ANONYMOUS',
  loadTossPayments: sdk.loadTossPayments,
}));

function resetSdk() {
  Object.values(sdk).forEach((mock) => mock.mockReset());
  sdk.setAmount.mockResolvedValue(undefined);
  sdk.requestPayment.mockResolvedValue(undefined);
  sdk.paymentMethodsDestroy.mockResolvedValue(undefined);
  sdk.agreementDestroy.mockResolvedValue(undefined);
  sdk.renderPaymentMethods.mockResolvedValue({
    on: sdk.paymentMethodsOn,
    destroy: sdk.paymentMethodsDestroy,
  });
  sdk.renderAgreement.mockResolvedValue({
    on: sdk.agreementOn,
    destroy: sdk.agreementDestroy,
  });
  sdk.widgetsFactory.mockReturnValue({
    setAmount: sdk.setAmount,
    renderPaymentMethods: sdk.renderPaymentMethods,
    renderAgreement: sdk.renderAgreement,
    requestPayment: sdk.requestPayment,
  });
  sdk.loadTossPayments.mockResolvedValue({ widgets: sdk.widgetsFactory });
}

const CLIENT_KEY = 'test_gck_iconsdocs00000000000001';

function tossPayload() {
  return {
    provider: 'toss',
    clientKey: CLIENT_KEY,
    customerKey: 'ANONYMOUS',
    orderId: 'O0123456789abcdef0123456789abcdef',
    orderName: 'ICONS 굿즈 주문',
    amount: 42_000,
    currency: 'KRW',
    successUrl: 'https://iconsip.com/api/payments/goods/confirm/toss/nonce-1',
    failUrl: 'https://iconsip.com/checkout',
  } as const;
}

describe('parseTossCheckoutPayload', () => {
  it('서버 prepare가 만든 payload를 그대로 통과시킨다', () => {
    expect(parseTossCheckoutPayload(tossPayload())).toEqual(tossPayload());
  });

  it('로컬 개발용 http 콜백 주소는 허용한다', () => {
    const parsed = parseTossCheckoutPayload({
      ...tossPayload(),
      successUrl: 'http://localhost:3000/api/payments/goods/confirm/toss/nonce-1',
      failUrl: 'http://127.0.0.1:3000/checkout',
    });

    expect(parsed?.successUrl).toBe('http://localhost:3000/api/payments/goods/confirm/toss/nonce-1');
  });

  it.each([
    ['allowlist 밖 키', { ...tossPayload(), metadata: 'provider-extra' }],
    ['중첩 객체', { ...tossPayload(), card: { direct: true } }],
    ['시크릿 형식 키', { ...tossPayload(), clientKey: 'test_gsk_iconsdocs00000000000001' }],
    ['API 개별 연동 키', { ...tossPayload(), clientKey: 'test_ck_iconsdocs00000000000001' }],
    ['잘못된 orderId', { ...tossPayload(), orderId: 'X0123456789abcdef0123456789abcdef' }],
    ['실수 amount', { ...tossPayload(), amount: 42_000.5 }],
    ['문자열 amount', { ...tossPayload(), amount: '42000' }],
    ['최소 미만 amount', { ...tossPayload(), amount: 99 }],
    ['원격 http successUrl', { ...tossPayload(), successUrl: 'http://iconsip.com/confirm' }],
    ['javascript failUrl', { ...tossPayload(), failUrl: 'javascript:alert(1)' }],
    ['다른 통화', { ...tossPayload(), currency: 'USD' }],
    ['회원 customerKey', { ...tossPayload(), customerKey: 'user-42' }],
    ['다른 provider', { ...tossPayload(), provider: 'korpay' }],
    ['제어문자 orderName', { ...tossPayload(), orderName: 'ICONS\u0000 주문' }],
    ['빈 orderName', { ...tossPayload(), orderName: '' }],
    ['배열', [tossPayload()]],
    ['null', null],
  ])('%s payload는 거부한다', (_label, payload) => {
    expect(parseTossCheckoutPayload(payload)).toBeNull();
  });
});

describe('mountTossPaymentWidgets', () => {
  beforeEach(() => {
    resetSdk();
  });

  it('문서 계약 순서대로 위젯을 띄운다', async () => {
    await mountTossPaymentWidgets(tossPayload());

    expect(sdk.loadTossPayments).toHaveBeenCalledOnce();
    expect(sdk.loadTossPayments).toHaveBeenCalledWith(CLIENT_KEY);
    // 내부 사용자 식별자 대신 SDK가 export하는 ANONYMOUS 상수만 보낸다.
    expect(sdk.widgetsFactory).toHaveBeenCalledWith({ customerKey: ANONYMOUS });
    expect(ANONYMOUS).toBe('@@ANONYMOUS');
    expect(sdk.setAmount).toHaveBeenCalledWith({ currency: 'KRW', value: 42_000 });
    // setAmount가 결제 UI 렌더보다 먼저여야 한다(NotSetupAmountError).
    expect(sdk.setAmount.mock.invocationCallOrder[0])
      .toBeLessThan(sdk.renderPaymentMethods.mock.invocationCallOrder[0]);
    expect(sdk.renderPaymentMethods).toHaveBeenCalledWith({ selector: TOSS_PAYMENT_METHODS_SELECTOR });
    expect(sdk.renderAgreement).toHaveBeenCalledWith({ selector: TOSS_AGREEMENT_SELECTOR });
    expect(TOSS_PAYMENT_METHODS_SELECTOR).toBe('#toss-payment-methods');
    expect(TOSS_AGREEMENT_SELECTOR).toBe('#toss-agreement');
  });

  it('deps로 주입한 loader만 쓰고 모듈 기본 loader는 건드리지 않는다', async () => {
    const injected = vi.fn().mockResolvedValue({ widgets: sdk.widgetsFactory });

    await mountTossPaymentWidgets(tossPayload(), { loadTossPayments: injected });

    expect(injected).toHaveBeenCalledWith(CLIENT_KEY);
    expect(sdk.loadTossPayments).not.toHaveBeenCalled();
  });

  it('Redirect 방식으로 결제를 요청하고 금액은 다시 싣지 않는다', async () => {
    const controller = await mountTossPaymentWidgets(tossPayload());

    await controller.requestPayment();

    expect(sdk.requestPayment).toHaveBeenCalledOnce();
    expect(sdk.requestPayment).toHaveBeenCalledWith({
      orderId: 'O0123456789abcdef0123456789abcdef',
      orderName: 'ICONS 굿즈 주문',
      successUrl: 'https://iconsip.com/api/payments/goods/confirm/toss/nonce-1',
      failUrl: 'https://iconsip.com/checkout',
    });
    // 금액은 setAmount가 진실원이다 — requestPayment에 다시 실으면 안 된다.
    expect(Object.keys(sdk.requestPayment.mock.calls[0][0])).not.toContain('amount');
  });

  it('updateAmount는 setAmount를 새 값으로 다시 부른다', async () => {
    const controller = await mountTossPaymentWidgets(tossPayload());

    await controller.updateAmount(31_000);

    expect(sdk.setAmount).toHaveBeenCalledTimes(2);
    expect(sdk.setAmount).toHaveBeenLastCalledWith({ currency: 'KRW', value: 31_000 });
  });

  it('destroy는 결제 UI와 약관 UI를 모두 정리한다', async () => {
    const controller = await mountTossPaymentWidgets(tossPayload());

    await controller.destroy();

    expect(sdk.paymentMethodsDestroy).toHaveBeenCalledOnce();
    expect(sdk.agreementDestroy).toHaveBeenCalledOnce();
  });

  it('필수 약관 동의 상태를 구독자에게 전달한다', async () => {
    const controller = await mountTossPaymentWidgets(tossPayload());
    const seen: boolean[] = [];
    controller.onAgreementChange((agreed) => seen.push(agreed));

    expect(sdk.agreementOn).toHaveBeenCalledWith('agreementStatusChange', expect.any(Function));
    const notify = sdk.agreementOn.mock.calls[0][1] as (status: unknown) => void;
    notify({ agreedRequiredTerms: false, agreements: [] });
    notify({ agreedRequiredTerms: true, agreements: [] });

    /* 등록 시점의 현재 상태(기본 동의 true — 2026-09-01 문서 테스트 키 실측:
       필수 약관은 체크된 채 렌더되고 초기 이벤트는 오지 않는다) → 해제 false
       → 재동의 true. */
    expect(seen).toEqual([true, false, true]);
  });
});

describe('TossWidgetCheckout', () => {
  beforeEach(() => {
    resetSdk();
  });

  it('유효한 payload면 위젯 컨테이너 두 개와 결제 버튼을 렌더링한다', () => {
    const html = renderToStaticMarkup(<TossWidgetCheckout payload={tossPayload()} />);

    expect(html).toContain('id="toss-payment-methods"');
    expect(html).toContain('id="toss-agreement"');
    expect(html).toContain('type="button"');
    expect(html).toContain('결제하기');
    expect(html).toContain('불러오는 중');
    // 마운트 전이라 버튼은 잠겨 있어야 한다.
    expect(html).toContain('disabled');
    expect(sdk.loadTossPayments).not.toHaveBeenCalled();
  });

  it.each([
    ['allowlist 밖 키', { ...tossPayload(), privateProviderShape: true }],
    ['시크릿 형식 clientKey', { ...tossPayload(), clientKey: 'test_gsk_iconsdocs00000000000001' }],
    ['provider 원문', { privateProviderShape: 'provider-secret' }],
  ])('%s payload는 위젯을 렌더링하지 않는다', (_label, payload) => {
    const html = renderToStaticMarkup(<TossWidgetCheckout payload={payload} />);

    expect(html).toContain('role="alert"');
    expect(html).toContain('결제 준비 정보를 확인하지 못했습니다.');
    expect(html).not.toContain('toss-payment-methods');
    expect(html).not.toContain('gsk');
    expect(html).not.toContain('privateProviderShape');
    expect(sdk.loadTossPayments).not.toHaveBeenCalled();
  });
});
