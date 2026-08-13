import type { PreparedCheckout } from '@/lib/payments/gateway';

interface PreparedCheckoutActionProps {
  readonly prepared: PreparedCheckout;
}

function validProviderUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || (
      url.protocol === 'http:'
      && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
    );
  } catch {
    return false;
  }
}

export function PreparedCheckoutAction({ prepared }: PreparedCheckoutActionProps) {
  if (prepared.action.kind === 'form_post') {
    if (!validProviderUrl(prepared.action.url)) {
      return <p className="checkout-error" role="alert">결제 준비 주소를 확인하지 못했습니다.</p>;
    }
    return (
      <form action={prepared.action.url} method="post">
        {Object.entries(prepared.action.fields).map(([name, value]) => (
          <input key={name} name={name} type="hidden" value={value} />
        ))}
        <button className="btn btn-holo checkout-submit" type="submit">결제하기</button>
      </form>
    );
  }

  if (prepared.action.kind === 'redirect') {
    if (!validProviderUrl(prepared.action.url)) {
      return <p className="checkout-error" role="alert">결제 준비 주소를 확인하지 못했습니다.</p>;
    }
    return <a className="btn btn-holo checkout-submit" href={prepared.action.url}>결제 계속하기</a>;
  }

  return (
    <p className="checkout-error" role="alert">
      지원하지 않는 결제 준비 방식입니다. 잠시 후 다시 시도해주세요.
    </p>
  );
}
