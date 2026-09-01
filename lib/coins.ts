/* 코인 표시 파생 (S8 #330).
 *
 * 코인은 출석·이벤트 참여로만 늘고 카드팩 교환으로만 줄어드는 무상 참여 재화다
 * (CONTEXT.md "코인", ADR-0003·ADR-0004). 결제 수단이 아니므로 이 파일에는 금액
 * 서식이 없고, 사용자-facing 문구에 '포인트·충전·마일리지' 어휘를 쓰지 않는다.
 *
 * 원장의 진실은 DB(coin_ledger)다. 여기 있는 것은 그 행을 사람이 읽는 문자열로
 * 바꾸는 규칙뿐이고, 잔액 계산은 하지 않는다 — 화면이 합을 다시 세기 시작하면
 * coin_balances 캐시와 갈라진다. */

/** DB `coin_ledger.reason` 체크 제약과 같은 목록. */
export type CoinReason = 'attendance' | 'exchange';

const REASON_LABELS: Record<CoinReason, string> = {
  attendance: '출석 체크 적립',
  exchange: '카드팩 교환 사용',
};

export function isCoinReason(value: unknown): value is CoinReason {
  return value === 'attendance' || value === 'exchange';
}

/** 모르는 사유도 행 자체는 남긴다 — 사용자가 자기 원장에서 줄이 사라지는 편이 더 나쁘다. */
export function coinReasonLabel(reason: string): string {
  return isCoinReason(reason) ? REASON_LABELS[reason] : '코인 변동';
}

/* 부호는 항상 붙인다. 적립과 사용이 같은 목록에 섞이는데 부호가 없으면 30이 적립인지
   차감인지 색으로만 구분해야 한다(색 단독 전달 금지). 음수 기호는 하이픈이 아니라
   U+2212 MINUS SIGN 이라 숫자 옆에서 폭이 맞는다. */
export function formatCoinDelta(amount: number): string {
  const rounded = Math.trunc(amount);
  const magnitude = Math.abs(rounded).toLocaleString('ko-KR');
  return rounded < 0 ? `−${magnitude}` : `+${magnitude}`;
}

/* 출석의 하루 경계는 Asia/Seoul 자정이다 — attendance_check_in RPC 가
   `(now() at time zone 'Asia/Seoul')::date` 로 같은 경계를 쓴다. UTC 로 재면
   한국 사용자에게 오전 9시 리셋으로 보이고, "오늘 출석함" 표시가 RPC 판정과
   9시간 어긋난다. */
const KST_ISO_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Asia/Seoul 기준 오늘 날짜(YYYY-MM-DD). coin_attendance.attended_on 과 같은 형식. */
export function kstTodayIsoDate(now: Date = new Date()): string {
  return KST_ISO_DATE.format(now);
}
