/**
 * 계좌수집 서비스 입금 내역 어댑터 (#257).
 *
 * 실제 provider(뱅크다류)는 계약 전이다(#255). 그래서 이 모듈은 **어느 provider가
 * 오더라도 변하지 않는 것** — 적재 표면의 모양과 정규화 규칙 — 만 정의하고,
 * 구현은 fake 하나만 둔다. provider가 정해지면 `BankDepositAdapter`를 하나 더
 * 구현해 등록하면 되고 DB·콘솔·확정 경로는 손대지 않는다.
 *
 * 확정은 여기 없다. 이 층은 "무엇이 들어왔는지"만 말하고, "어느 주문의 대금인지"는
 * 사람이 콘솔에서 누른다(ADR-0007).
 */

export interface BankDepositRecord {
  /** provider가 그 입금에 붙인 고유 식별자. 재수집 멱등의 유일한 근거다. */
  readonly externalId: string;
  /** ISO 8601. */
  readonly depositedAt: string;
  readonly depositorName: string;
  /** 원(KRW) 정수. */
  readonly amount: number;
  /** 적요·거래번호처럼 사람이 은행 앱에서 되짚을 문자열. */
  readonly rawReference?: string;
}

export interface BankDepositAdapter {
  /** 적재 행의 `source`가 된다. 40자 이내. */
  readonly name: string;
  /**
   * `since` 이후의 입금 내역. 폴링이든 웹훅 버퍼든 이 모양으로 돌려준다.
   * 겹쳐 돌려줘도 된다 — 중복은 DB가 (source, external_id)로 걸러 낸다.
   */
  fetchSince(since: Date): Promise<BankDepositRecord[]>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * provider 응답 한 건을 적재 가능한 모양으로 정규화한다.
 *
 * 판정을 느슨하게 두지 않는 이유는, 여기서 통과한 값이 곧 "돈이 들어왔다"는
 * 근거가 되기 때문이다. 금액이나 시각을 추측해 채우지 않고 버린다 — 버려진
 * 입금은 수동 대조 콘솔(#256)에서 사람이 처리할 수 있지만, 잘못 채워진 입금은
 * 잘못된 확정을 부른다.
 */
export function normalizeBankDepositRecord(value: unknown): BankDepositRecord | null {
  if (!isRecord(value)) return null;

  const externalId = typeof value.externalId === 'string' ? value.externalId.trim() : '';
  const depositorName = typeof value.depositorName === 'string' ? value.depositorName.trim() : '';
  const depositedAt = typeof value.depositedAt === 'string' ? value.depositedAt.trim() : '';
  const amount = typeof value.amount === 'number' ? value.amount : Number.NaN;
  const rawReference = typeof value.rawReference === 'string' ? value.rawReference.trim() : '';

  if (!externalId || externalId.length > 200) return null;
  if (!depositorName || depositorName.length > 200) return null;
  if (!Number.isSafeInteger(amount) || amount <= 0) return null;
  if (!depositedAt || Number.isNaN(Date.parse(depositedAt))) return null;

  return {
    externalId,
    depositedAt: new Date(depositedAt).toISOString(),
    depositorName,
    amount,
    ...(rawReference ? { rawReference } : {}),
  };
}

/**
 * 배치 정규화. 깨진 항목은 조용히 버리고 나머지를 살린다 — 한 건 때문에 배치가
 * 통째로 실패하면 재수집이 같은 지점에서 영원히 막힌다(DB `record_bank_deposits`도
 * 같은 규칙이다).
 */
export function normalizeBankDepositBatch(values: readonly unknown[]): BankDepositRecord[] {
  const normalized: BankDepositRecord[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const record = normalizeBankDepositRecord(value);
    if (!record || seen.has(record.externalId)) continue;
    seen.add(record.externalId);
    normalized.push(record);
  }
  return normalized;
}

/** DB `suggest_bank_deposit_order`가 낼 수 있는 확신도의 전부. */
const BANK_DEPOSIT_CONFIDENCES = ['code_amount', 'code', 'amount_name'] as const;

export type BankDepositConfidence = (typeof BANK_DEPOSIT_CONFIDENCES)[number];

/** 콘솔에 보여줄 매칭 확신도 문구. DB `suggest_bank_deposit_order`가 주는 값이다. */
export const BANK_DEPOSIT_CONFIDENCE_LABELS: Record<BankDepositConfidence, string> = {
  code_amount: '주문코드·금액 일치',
  code: '주문코드 일치 · 금액 다름',
  amount_name: '금액·이름 일치 · 코드 없음',
};

/**
 * DB가 준 확신도 문자열을 아는 값으로 좁힌다. `normalizeBankDepositRecord`와 같은
 * 규칙이다 — 모르는 값은 추측해 채우지 않고 버린다. 버려진 제안은 콘솔에 "제안 없음"
 * 으로 떠서 사람이 직접 주문을 고르게 된다.
 *
 * 좁히기를 이 한 곳에 모아 두면 아래 표시 함수와 콘솔 행 타입이 세 값만 알면 된다.
 */
export function normalizeBankDepositConfidence(value: unknown): BankDepositConfidence | null {
  /* 아는 값과 하나씩 맞춰 본다. `value in LABELS`는 프로토타입 체인까지 보므로
     'toString' 같은 입력이 확신도로 승격되고, 라벨 조회가 문자열 대신 함수를 낸다. */
  return BANK_DEPOSIT_CONFIDENCES.find((known) => known === value) ?? null;
}

export function bankDepositConfidenceLabel(value: BankDepositConfidence | null): string {
  return value ? BANK_DEPOSIT_CONFIDENCE_LABELS[value] : '제안 없음';
}

/**
 * 금액이 다른 제안은 확정 전에 사람이 한 번 더 봐야 한다 — 부분 입금이나
 * 수수료 차감일 수도 있고, 남의 주문일 수도 있다.
 */
export function bankDepositNeedsSecondLook(confidence: BankDepositConfidence | null) {
  return confidence === 'code';
}
