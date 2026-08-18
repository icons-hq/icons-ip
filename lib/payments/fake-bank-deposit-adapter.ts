import type { BankDepositAdapter, BankDepositRecord } from './bank-deposit-feed';

/**
 * 계약 전 어댑터 (#257).
 *
 * 실제 계좌수집 서비스(#255)가 붙기 전까지 적재 경로가 살아 있는지 확인하는
 * 용도다. 스스로 입금을 만들어 내지 않는다 — 생성자가 받은 목록만 돌려준다.
 * "테스트용 어댑터가 가짜 돈을 만든다"는 상황은 결제 도메인에서 특히 위험하고,
 * 실수로 production에 등록되면 존재하지 않는 입금이 콘솔에 뜬다.
 */
export class FakeBankDepositAdapter implements BankDepositAdapter {
  readonly name = 'fake';

  constructor(private readonly records: readonly BankDepositRecord[] = []) {}

  async fetchSince(since: Date): Promise<BankDepositRecord[]> {
    const floor = since.getTime();
    return this.records.filter((record) => Date.parse(record.depositedAt) >= floor);
  }
}
