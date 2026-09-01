import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { PaymentConfirmation } from './PaymentConfirmation';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
}));

const referenceId = '7ad4c967-3d48-44da-a665-64731ac33f62';

function renderConfirmation({
  destinationPath,
  fallbackHref,
  fallbackLabel,
  subject,
}: {
  destinationPath: string | null;
  fallbackHref: string;
  fallbackLabel: string;
  subject: '주문' | '예매';
}) {
  return renderToStaticMarkup(
    <PaymentConfirmation
      amount={null}
      destinationPath={destinationPath}
      fallbackHref={fallbackHref}
      fallbackLabel={fallbackLabel}
      orderId={null}
      paymentKey={null}
      paymentType={null}
      resumePath="/checkout/success"
      subject={subject}
    />,
  );
}

describe('PaymentConfirmation', () => {
  it('preserves the order subject and destination link', () => {
    const html = renderConfirmation({
      destinationPath: `/checkout/${referenceId}`,
      fallbackHref: '/checkout',
      fallbackLabel: '진행 중인 주문 찾기',
      subject: '주문',
    });

    expect(html).toContain('주문 화면에서 상태를 다시 확인해주세요.');
    expect(html).toContain(`href="/checkout/${referenceId}"`);
    expect(html).toContain('주문 화면으로');
  });

  it('uses the ticket subject and destination link', () => {
    const html = renderConfirmation({
      destinationPath: `/ticket-checkout/${referenceId}`,
      fallbackHref: '/offline-popups',
      fallbackLabel: '오프라인 팝업으로 돌아가기',
      subject: '예매',
    });

    expect(html).toContain('예매 화면에서 상태를 다시 확인해주세요.');
    expect(html).toContain(`href="/ticket-checkout/${referenceId}"`);
    expect(html).toContain('예매 화면으로');
  });

  it('uses the caller-provided fallback when no destination is known', () => {
    const html = renderConfirmation({
      destinationPath: null,
      fallbackHref: '/offline-popups',
      fallbackLabel: '오프라인 팝업으로 돌아가기',
      subject: '예매',
    });

    expect(html).toContain('href="/offline-popups"');
    expect(html).toContain('오프라인 팝업으로 돌아가기');
  });
});
