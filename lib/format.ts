/* 금액·숫자 표시 파생. lib/ip-display.ts와 같은 자리의 module이다.
   화면마다 재구현하면 같은 값이 다른 표기로 갈린다 — 실제로 티켓 예매 흐름에서
   `12,000원`과 `₩12,000`이 번갈아 보였다. 통화 표기는 여기서만 결정한다. */

/** 금액을 단독으로 보여줄 때 쓴다. 기본값이다. */
export const krw = (value: number) => `₩${value.toLocaleString('ko-KR')}`;

/** 금액 뒤에 서술이 붙는 자리에만 쓴다 — `12,000원 결제하기`처럼.
    `₩12,000 결제하기`는 읽기 어색해서 이 경우에만 예외를 둔다. */
export const krwAmountWords = (value: number) => `${value.toLocaleString('ko-KR')}원`;

/** 팔로워 수처럼 자릿수가 큰 지표를 좁은 자리에 넣을 때 — 76500 → 7.7만. */
export const compactNumber = (value: number) => new Intl.NumberFormat('ko-KR', {
  notation: 'compact',
  maximumFractionDigits: 1,
}).format(value);
