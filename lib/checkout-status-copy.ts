import {
  checkoutDeadlineTimeLabel,
  type CheckoutOrderState,
  type CheckoutPaymentClosure,
  type CheckoutPaymentReading,
  type CheckoutReorderMode,
} from './checkout';

/*
 * 결제 화면(/checkout/{orderId})과 주문 상세가 같은 주문을 같은 말로 안내하도록 문구를
 * 한곳에 둔다. 주문 상세는 서버 컴포넌트라 클라이언트 모듈(CheckoutOrder)의 함수를 부를
 * 수 없다.
 */

export interface StatusCopy {
  readonly title: string;
  readonly body: string;
}

/**
 * 같은 주문으로 결제를 다시 시작할 수 없는 주문의 안내. "잠시 후 다시 시도"처럼
 * 반복해도 풀리지 않는 약속을 하지 않고, 실제로 일어나는 다음 일을 말한다.
 */
export function closedPaymentCopy(
  closure: CheckoutPaymentClosure,
  { orderExpiresAt, provider }: { orderExpiresAt: string | null; provider: string | null },
): StatusCopy {
  if (closure === 'not_approved') {
    return {
      title: '이 주문은 다시 결제할 수 없어요',
      body: '결제가 승인되지 않았어요. 같은 주문으로는 다시 결제할 수 없으니 이 주문을 취소하고 같은 굿즈로 다시 주문해주세요. 취소하면 재고와 사용한 쿠폰·적립금이 바로 돌아와요.',
    };
  }
  if (closure === 'cancellation_requested') {
    return {
      title: '취소 요청을 처리하고 있어요',
      body: '이 주문에는 처리 중인 취소 요청이 있어 결제를 진행할 수 없어요. 진행 상태는 주문 상세에서 확인할 수 있어요.',
    };
  }
  const deadline = checkoutDeadlineTimeLabel(orderExpiresAt);
  /* 토스는 인증 뒤 10분 안에 승인 API를 부르지 않으면 결제가 EXPIRED로 끝난다(문서
     127). 시간이 지난 시도는 콜백이 와도 claim이 거절해 승인 API를 부르지 않는다.
     다른 provider는 같은 근거를 확인하지 않았으므로 청구 여부를 단정하지 않는다. */
  const charge = provider === 'toss' ? ' 결제는 진행되지 않았고 청구된 금액은 없어요.' : '';
  return {
    title: '결제 가능 시간이 지났어요',
    body: `결제 준비 후 유효 시간이 지나 이 주문으로는 결제할 수 없어요.${charge} 주문은 결제 기한${deadline ? `(${deadline})` : ''}이 지나면 몇 분 안에 자동으로 취소되고, 재고와 사용한 쿠폰·적립금이 돌아와요. 그다음 다시 주문해주세요.`,
  };
}

/**
 * "이 주문 취소하고 다시 주문하기"로 이 화면에서 주문을 취소한 뒤의 안내. 취소 전 안내
 * ("이 주문을 취소하고 다시 주문해주세요")를 그대로 두면 이미 끝난 일을 다시 하라고 말한다.
 * 다시 담은 결과(일부만 담김·담을 굿즈 없음 등)는 바로 아래 결과 안내가 말한다.
 */
export const REORDER_CANCELED_COPY: StatusCopy = {
  title: '주문을 취소했어요',
  body: '이 주문은 취소됐어요. 같은 굿즈를 장바구니에 다시 담은 결과는 아래에서 확인해주세요.',
};

/* 웹훅·재정합 설정과 무관하게 지킬 수 있는 말만 한다 — "닫아도 확인은 계속된다"는
   자동 재정합 경로가 열려 있을 때만 참이다. */
const CHECKING_COPY: StatusCopy = {
  title: '결제를 확인하고 있어요',
  body: '결제사 승인 결과를 아직 확정하지 못했어요. 확인이 늦어지거나 결제 금액이 빠져나갔다면 고객센터 1:1 문의로 알려주세요.',
};

/** 결제 기한이 지났지만 아직 만료 sweep이 닫지 않은 카드 결제 대기 주문. */
function cardDeadlinePassedCopy(reorderMode: CheckoutReorderMode | null): StatusCopy {
  /* 즉시 취소할 수 없는 주문(남은 prepared 시도 등)은 결제 기한 뒤 만료 sweep이 닫는다. */
  return reorderMode
    ? { title: '결제 가능한 시간이 지났어요', body: '이 주문으로는 더 이상 결제할 수 없어요. 주문을 취소하면 재고와 사용한 쿠폰·적립금이 바로 돌아와요. 같은 굿즈로 다시 주문해주세요.' }
    : { title: '결제 가능한 시간이 지났어요', body: '이 주문으로는 더 이상 결제할 수 없어요. 주문은 몇 분 안에 자동으로 취소되고, 재고와 사용한 쿠폰·적립금이 돌아와요. 그다음 다시 주문해주세요.' };
}

export function checkoutStatusCopy({
  state,
  closedCopy,
  isBankTransfer,
  orderStatus,
  reorderMode,
  reorderCanceled = false,
}: {
  state: CheckoutOrderState;
  closedCopy: StatusCopy | null;
  isBankTransfer: boolean;
  orderStatus: string;
  reorderMode: CheckoutReorderMode | null;
  /** 이 화면의 "취소하고 다시 주문하기"가 주문 취소까지 마쳤는지. */
  reorderCanceled?: boolean;
}): StatusCopy | null {
  if (state === 'complete') return { title: '결제가 확인됐어요', body: '주문이 안전하게 접수됐습니다. 배송 진행은 주문 내역에서 이어서 확인할 수 있어요.' };
  if (state === 'checking') return CHECKING_COPY;
  /* 승인을 기다리는 사이 접수된 취소 요청 때문에 승인된 결제를 취소하는 중이다
     (20261012110100). 승인은 확정됐으므로 '확인 중'으로 말하지 않는다. 자동 결제 취소가
     실패하면 요청이 담당자 확인으로 넘어가므로 끝나는 시점은 약속하지 않는다. */
  if (state === 'refund_in_progress') {
    return isBankTransfer
      ? { title: '환불을 진행하고 있어요', body: '입금은 확인됐고, 취소 요청에 따라 환불을 진행하고 있어요. 진행 상태는 주문 상세에서 확인할 수 있어요.' }
      : { title: '결제 취소를 진행하고 있어요', body: '결제는 승인됐고, 취소 요청에 따라 결제 취소를 진행하고 있어요. 진행 상태는 주문 상세에서 확인할 수 있어요.' };
  }
  /* 화면의 주문 스냅샷은 취소 전 그대로라(다시 담은 결과를 남기려고 새로 읽지 않는다)
     닫힌 결제·기한 경과 안내보다 앞에서 본다. */
  if (reorderCanceled && (state === 'payment_closed' || state === 'closed')) return REORDER_CANCELED_COPY;
  if (closedCopy) return closedCopy;
  if (state === 'closed') {
    if (isBankTransfer) {
      return { title: '입금 기한이 지났어요', body: '선점된 재고는 자동으로 복원됩니다. 기한이 지난 뒤 입금하셨다면 고객센터 문의로 알려주세요 — 주문은 되살아나지 않고 입금액을 반환해 드립니다.' };
    }
    if (orderStatus === 'canceled') {
      return { title: '취소된 주문이에요', body: '이 주문은 취소됐어요. 같은 굿즈를 다시 담아 새로 주문할 수 있어요.' };
    }
    return cardDeadlinePassedCopy(reorderMode);
  }
  if (isBankTransfer) return { title: '입금 정보를 확인하세요', body: '주문 금액과 입금자명을 확인하고 안내된 계좌로 기한 안에 입금해주세요.' };
  return null;
}

export interface OrderDetailPaymentLink {
  readonly href: string;
  readonly label: string;
}

/** 주문 상세 상단의 결제 안내와, 다음 행동이 결제 화면에 있을 때만 서는 안내 띠. */
export interface OrderDetailCardPaymentNotice {
  readonly header: StatusCopy;
  readonly banner: (StatusCopy & { readonly link: OrderDetailPaymentLink }) | null;
}

/**
 * 결제 대기 카드 주문의 주문 상세 안내. 결제 화면과 같은 판독(`readCheckoutPayment`)·
 * 같은 문구를 쓰고, "이어가기"는 같은 주문으로 결제를 다시 준비할 수 있을 때(`payable`)만
 * 약속한다. 승인 거절·시도 만료처럼 닫힌 결제를 '확인 중'으로 말하면 청구가 진행 중인
 * 것처럼 읽힌다. 결제 시도를 읽지 못했으면(`reading` null) 상태를 단정하지 않는다.
 */
export function orderDetailCardPaymentNotice(
  reading: CheckoutPaymentReading | null,
  { orderId, orderExpiresAt }: { orderId: string; orderExpiresAt: string | null },
): OrderDetailCardPaymentNotice {
  const checkoutHref = `/checkout/${orderId}`;
  const reorderBanner = (title: string) => ({
    title,
    body: '결제 화면에서 이 주문을 취소하고 같은 굿즈로 다시 주문할 수 있어요.',
    link: { href: checkoutHref, label: '주문 정리하고 다시 주문하기' },
  });

  const undetermined: OrderDetailCardPaymentNotice = {
    header: {
      title: '결제가 끝나지 않은 주문이에요',
      body: '결제 화면에서 이 주문의 결제 상태와 다음 단계를 확인할 수 있어요.',
    },
    banner: {
      title: '결제 상태를 확인해주세요',
      body: '결제 화면에서 현재 상태를 확인할 수 있어요.',
      link: { href: checkoutHref, label: '결제 화면 보기' },
    },
  };
  if (!reading) return undetermined;

  switch (reading.state) {
    case 'payable':
      return {
        header: {
          title: '결제를 기다리고 있어요',
          body: '아직 결제가 끝나지 않은 주문이에요. 진행하지 않을 주문은 아래에서 취소할 수 있어요.',
        },
        banner: {
          title: '결제를 마쳐주세요',
          body: '결제 화면에서 이 주문의 결제를 이어갈 수 있어요.',
          link: { href: checkoutHref, label: '결제 이어가기' },
        },
      };
    case 'checking':
      return {
        header: CHECKING_COPY,
        banner: {
          title: '결제 상태를 확인해주세요',
          body: '결제 화면에서 현재 상태를 확인할 수 있어요.',
          link: { href: checkoutHref, label: '결제 상태 보기' },
        },
      };
    case 'refund_in_progress':
      /* 진행 상태는 이 화면의 취소 안내가 보여준다. */
      return {
        header: {
          title: '결제 취소를 진행하고 있어요',
          body: '결제는 승인됐고, 취소 요청에 따라 결제 취소를 진행하고 있어요. 진행 상태는 아래 취소 안내에서 확인할 수 있어요.',
        },
        banner: null,
      };
    case 'payment_closed':
      if (!reading.closure) return undetermined;
      if (reading.closure === 'cancellation_requested') {
        return {
          header: {
            title: '취소 요청을 처리하고 있어요',
            body: '이 주문에는 처리 중인 취소 요청이 있어 결제를 진행할 수 없어요. 진행 상태는 아래 취소 안내에서 확인할 수 있어요.',
          },
          banner: null,
        };
      }
      return {
        header: closedPaymentCopy(reading.closure, { orderExpiresAt, provider: reading.provider }),
        /* 시도 만료 주문은 고객 취소가 즉시 끝나지 않으므로(reorderMode 없음) 결제 화면에도
           정리 액션이 없다 — 안내 띠로 그곳에 보내지 않는다. */
        banner: reading.reorderMode === 'cancel_then_reorder'
          ? reorderBanner('결제가 승인되지 않았어요')
          : null,
      };
    case 'closed':
      return {
        header: cardDeadlinePassedCopy(reading.reorderMode),
        banner: reading.reorderMode === 'cancel_then_reorder'
          ? reorderBanner('이 주문으로는 결제할 수 없어요')
          : null,
      };
    case 'complete':
      return {
        header: { title: '결제가 확인됐어요', body: '주문이 안전하게 접수됐습니다.' },
        banner: null,
      };
  }
}
