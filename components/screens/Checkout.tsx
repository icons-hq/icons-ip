'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState, type FormEvent } from 'react';
import { placeOrderAction } from '@/app/checkout/actions';
import { useCart } from '@/components/shell/CartProvider';
import type { CatalogSnapshot } from '@/lib/catalog';
import {
  checkoutAddressErrors,
  type CheckoutAddress,
  type CheckoutAddressErrors,
  type CheckoutAddressField,
} from '@/lib/checkout';

const krw = (value: number) => `₩${value.toLocaleString('ko-KR')}`;

const actionErrors = {
  invalid_address: '배송지 정보를 다시 확인해주세요.',
  invalid_request: '주문 요청을 다시 시작해주세요.',
  auth_required: '로그인이 만료됐어요. 다시 로그인해주세요.',
  onboarding_required: '프로필 설정을 먼저 완료해주세요.',
  payment_unavailable: '현재 결제 환경을 확인 중이에요. 잠시 후 다시 시도해주세요.',
  empty_cart: '장바구니가 비어 있어요.',
  out_of_stock: '결제 직전 재고가 변경됐어요. 장바구니에서 수량을 다시 확인해주세요.',
  unavailable: '주문을 만들지 못했어요. 잠시 후 다시 시도해주세요.',
} as const;

interface CheckoutProps {
  catalog: Pick<CatalogSnapshot, 'goods' | 'ips'>;
  latestAddress: CheckoutAddress | null;
  paymentAvailable: boolean;
  resumeOrderId: string | null;
}

const addressFieldOrder: CheckoutAddressField[] = [
  'recipientName',
  'phone',
  'postalCode',
  'address1',
  'address2',
  'deliveryNote',
];

export function Checkout({ catalog, latestAddress, paymentAvailable, resumeOrderId }: CheckoutProps) {
  const router = useRouter();
  const { items, ready, mode, pending: cartPending, error: cartError, refresh } = useCart();
  const checkoutKey = useRef<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<CheckoutAddressErrors>({});
  const [address, setAddress] = useState<CheckoutAddress>({
    recipientName: latestAddress?.recipientName ?? '',
    phone: latestAddress?.phone ?? '',
    postalCode: latestAddress?.postalCode ?? '',
    address1: latestAddress?.address1 ?? '',
    address2: latestAddress?.address2 ?? '',
    deliveryNote: latestAddress?.deliveryNote ?? '',
  });

  const lines = useMemo(() => {
    const goodsById = new Map(catalog.goods.map((good) => [good.id, good]));
    const ipsById = new Map(catalog.ips.map((ip) => [ip.id, ip]));
    return items.map((item) => {
      const good = goodsById.get(item.goodId);
      return { ...item, good, ip: good ? ipsById.get(good.ip) : undefined };
    });
  }, [catalog.goods, catalog.ips, items]);
  const subtotal = lines.reduce((sum, line) => sum + (line.good?.price ?? 0) * line.qty, 0);
  const unavailable = lines.some(({ good, qty }) => (
    !good || good.stock === 'soldout' || good.stockQty < qty
  ));

  const setField = (field: keyof CheckoutAddress, value: string) => {
    setAddress((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting || cartPending || mode !== 'server' || unavailable || !paymentAvailable) return;

    const nextFieldErrors = checkoutAddressErrors(address);
    if (Object.keys(nextFieldErrors).length > 0) {
      setFieldErrors(nextFieldErrors);
      const firstInvalidField = addressFieldOrder.find((field) => nextFieldErrors[field]);
      if (firstInvalidField) {
        window.requestAnimationFrame(() => {
          document.getElementById(`checkout-${firstInvalidField}`)?.focus();
        });
      }
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    checkoutKey.current ??= crypto.randomUUID();
    let result: Awaited<ReturnType<typeof placeOrderAction>>;
    try {
      result = await placeOrderAction(address, checkoutKey.current);
    } catch {
      setSubmitError(actionErrors.unavailable);
      setSubmitting(false);
      return;
    }
    if (!result.ok) {
      setSubmitError(actionErrors[result.error]);
      setSubmitting(false);
      return;
    }

    await refresh();
    window.scrollTo(0, 0);
    router.push(`/checkout/${result.orderId}`);
  };

  if (!ready || cartPending) {
    return (
      <main className="checkout-page">
        <div className="wrap checkout-loading" role="status">계정 장바구니를 확인하고 있어요.</div>
      </main>
    );
  }

  if (mode !== 'server') {
    return (
      <main className="checkout-page">
        <div className="wrap checkout-empty card">
          <span className="eyebrow">계정 연결 필요</span>
          <h1>장바구니를 계정에 연결하지 못했어요</h1>
          <p>{cartError ?? '로그인 상태와 네트워크를 확인한 뒤 다시 시도해주세요.'}</p>
          <button className="btn btn-holo" type="button" onClick={() => void refresh()}>다시 연결</button>
          <Link className="btn btn-ghost" href="/cart">장바구니로 돌아가기</Link>
        </div>
      </main>
    );
  }

  if (lines.length === 0) {
    return (
      <main className="checkout-page">
        <div className="wrap checkout-empty card">
          <span className="eyebrow">{resumeOrderId ? 'ORDER IN PROGRESS' : 'CHECKOUT'}</span>
          <h1>{resumeOrderId ? '진행 중인 주문이 있어요' : '주문할 굿즈가 없어요'}</h1>
          <p>{resumeOrderId
            ? '주문 생성 응답을 놓쳤거나 결제 확인을 이어가는 중일 수 있어요.'
            : '장바구니에 굿즈를 담은 뒤 다시 와주세요.'}</p>
          {resumeOrderId && (
            <Link className="btn btn-holo" href={`/checkout/${resumeOrderId}`}>결제 이어가기</Link>
          )}
          <Link className={resumeOrderId ? 'btn btn-ghost' : 'btn btn-holo'} href="/shop">굿즈 보러 가기</Link>
        </div>
      </main>
    );
  }

  return (
    <main className="checkout-page">
      <header className="checkout-header">
        <div className="wrap">
          <div className="eyebrow" style={{ color: 'var(--cyan)' }}>사요 · 체크아웃</div>
          <h1 className="h-xl">배송지를 확인하고<br />결제를 준비해요</h1>
          <p>재고는 주문 생성 후 15분 동안 선점됩니다. 최종 완료는 결제 확인 후 안내해요.</p>
        </div>
      </header>

      <form className="wrap checkout-layout" onSubmit={submit} aria-busy={submitting} noValidate>
        <section className="checkout-form card" aria-labelledby="shipping-title">
          <div className="checkout-section-heading">
            <span className="checkout-step mono">01</span>
            <div>
              <h2 id="shipping-title">배송지</h2>
              <p>{latestAddress ? '최근 배송지를 불러왔어요. 주문 전 한 번 더 확인해주세요.' : '수령에 필요한 정보만 주문에 안전하게 저장합니다.'}</p>
            </div>
          </div>

          <div className="checkout-fields">
            <label>
              <span>받는 분</span>
              <input id="checkout-recipientName" required autoComplete="name" maxLength={50} aria-invalid={Boolean(fieldErrors.recipientName)} aria-describedby={fieldErrors.recipientName ? 'checkout-recipientName-error' : undefined} value={address.recipientName} onChange={(event) => setField('recipientName', event.target.value)} />
              {fieldErrors.recipientName && <small id="checkout-recipientName-error" className="checkout-field-error">{fieldErrors.recipientName}</small>}
            </label>
            <label>
              <span>연락처</span>
              <input id="checkout-phone" required autoComplete="tel" inputMode="tel" maxLength={20} aria-invalid={Boolean(fieldErrors.phone)} aria-describedby={fieldErrors.phone ? 'checkout-phone-error' : undefined} placeholder="010-1234-5678" value={address.phone} onChange={(event) => setField('phone', event.target.value)} />
              {fieldErrors.phone && <small id="checkout-phone-error" className="checkout-field-error">{fieldErrors.phone}</small>}
            </label>
            <label className="checkout-field--postal">
              <span>우편번호</span>
              <input id="checkout-postalCode" required autoComplete="postal-code" inputMode="numeric" maxLength={5} aria-invalid={Boolean(fieldErrors.postalCode)} aria-describedby={fieldErrors.postalCode ? 'checkout-postalCode-error' : undefined} placeholder="00000" value={address.postalCode} onChange={(event) => setField('postalCode', event.target.value)} />
              {fieldErrors.postalCode && <small id="checkout-postalCode-error" className="checkout-field-error">{fieldErrors.postalCode}</small>}
            </label>
            <label className="checkout-field--wide">
              <span>기본 주소</span>
              <input id="checkout-address1" required autoComplete="address-line1" maxLength={200} aria-invalid={Boolean(fieldErrors.address1)} aria-describedby={fieldErrors.address1 ? 'checkout-address1-error' : undefined} value={address.address1} onChange={(event) => setField('address1', event.target.value)} />
              {fieldErrors.address1 && <small id="checkout-address1-error" className="checkout-field-error">{fieldErrors.address1}</small>}
            </label>
            <label className="checkout-field--wide">
              <span>상세 주소 <em>선택</em></span>
              <input id="checkout-address2" autoComplete="address-line2" maxLength={200} aria-invalid={Boolean(fieldErrors.address2)} aria-describedby={fieldErrors.address2 ? 'checkout-address2-error' : undefined} value={address.address2 ?? ''} onChange={(event) => setField('address2', event.target.value)} />
              {fieldErrors.address2 && <small id="checkout-address2-error" className="checkout-field-error">{fieldErrors.address2}</small>}
            </label>
            <label className="checkout-field--wide">
              <span>배송 메모 <em>선택</em></span>
              <input id="checkout-deliveryNote" maxLength={200} aria-invalid={Boolean(fieldErrors.deliveryNote)} aria-describedby={fieldErrors.deliveryNote ? 'checkout-deliveryNote-error' : undefined} placeholder="예: 문 앞에 놓아주세요" value={address.deliveryNote ?? ''} onChange={(event) => setField('deliveryNote', event.target.value)} />
              {fieldErrors.deliveryNote && <small id="checkout-deliveryNote-error" className="checkout-field-error">{fieldErrors.deliveryNote}</small>}
            </label>
          </div>
        </section>

        <aside className="checkout-summary card" aria-label="최종 주문 요약">
          <div className="checkout-section-heading checkout-section-heading--compact">
            <span className="checkout-step mono">02</span>
            <h2>주문 확인</h2>
          </div>
          <div className="checkout-items">
            {lines.map(({ goodId, good, ip, qty }) => (
              <div className="checkout-item" key={goodId}>
                <div>
                  <span>{ip?.title ?? 'ICONS'} · {good?.type ?? '판매 종료'}</span>
                  <strong>{good?.name ?? goodId}</strong>
                </div>
                <span className="mono">{qty} × {krw(good?.price ?? 0)}</span>
              </div>
            ))}
          </div>
          <dl className="checkout-totals">
            <div><dt>굿즈 금액</dt><dd>{krw(subtotal)}</dd></div>
            <div><dt>배송비</dt><dd>무료</dd></div>
            <div className="checkout-total"><dt>결제 금액</dt><dd>{krw(subtotal)}</dd></div>
          </dl>

          {unavailable && <p className="checkout-error" role="alert">재고가 변경된 굿즈가 있어요. 장바구니에서 수량을 확인해주세요.</p>}
          {!paymentAvailable && <p className="checkout-error" role="alert">결제 환경을 확인 중이라 지금은 주문을 만들 수 없어요.</p>}
          {submitError && <p className="checkout-error" role="alert">{submitError}</p>}
          <button className="btn btn-holo checkout-submit" disabled={submitting || cartPending || unavailable || !paymentAvailable}>
            {submitting ? '재고를 확인하는 중' : '주문 만들고 결제하기'}
          </button>
          <p className="money-caption">이 버튼은 결제를 완료하지 않습니다. 다음 화면에서 결제수단과 약관을 확인합니다.</p>
          <Link className="checkout-back" href="/cart">← 장바구니 수정</Link>
        </aside>
      </form>
    </main>
  );
}
