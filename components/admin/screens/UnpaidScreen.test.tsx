import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AdminUnpaidConsoleData } from '@/lib/admin/unpaid';
import { UnpaidScreen } from './UnpaidScreen';

vi.mock('@/app/admin/unpaid-actions', () => ({
  cancelUnpaidBankTransferOrderAction: vi.fn(),
  confirmBankDepositAction: vi.fn(),
  confirmBankTransferDepositAction: vi.fn(),
  extendBankTransferDeadlineAction: vi.fn(),
  ignoreBankDepositAction: vi.fn(),
}));

const now = new Date('2026-08-18T00:00:00.000Z');

function consoleData(overrides: Partial<AdminUnpaidConsoleData> = {}): AdminUnpaidConsoleData {
  return {
    filters: { query: '', page: 1, selectedOrderId: null },
    pageSize: 20,
    total: 2,
    deposits: [],
    rows: [
      {
        id: '9a3f21c0-1111-4000-8000-000000000abc',
        buyerName: '홍길동',
        buyerId: '00000000-0000-4000-8000-000000000d01',
        total: 23000,
        createdAt: '2026-08-17T09:00:00.000Z',
        expiresAt: '2026-08-18T02:00:00.000Z',
        extendedAt: null,
        depositCode: '9A3F21C0',
        itemSummary: '무통장 굿즈 × 1',
        attemptState: 'prepared',
      },
      {
        id: '55550000-2222-4000-8000-000000000def',
        buyerName: '김철수',
        buyerId: '00000000-0000-4000-8000-000000000d03',
        total: 41000,
        createdAt: '2026-08-17T22:00:00.000Z',
        expiresAt: '2026-08-18T20:00:00.000Z',
        extendedAt: '2026-08-17T23:00:00.000Z',
        depositCode: '55550000',
        itemSummary: '한정 굿즈 × 2',
        attemptState: 'prepared',
      },
    ],
    ...overrides,
  };
}

describe('UnpaidScreen', () => {
  it('입금 대조에 필요한 코드·금액·남은 기한을 보여준다', () => {
    const html = renderToStaticMarkup(<UnpaidScreen data={consoleData()} now={now} />);

    expect(html).toContain('9A3F21C0');
    expect(html).toContain('23,000');
    expect(html).toContain('2시간 0분 남음');
    expect(html).toContain('무통장 굿즈 × 1');
  });

  /*
   * 목록에 주소·연락처를 싣지 않는다. 입금 대조에 필요한 정보가 아니고,
   * 이 화면은 하루 종일 열려 있는 콘솔이다.
   */
  it('연장된 주문을 표시하고 임박한 기한만 강조한다', () => {
    const html = renderToStaticMarkup(<UnpaidScreen data={consoleData()} now={now} />);

    expect(html).toContain('연장됨');
    /* 2시간 남은 주문 하나만 임박이다 — 20시간 남은 주문까지 붉으면 신호가 죽는다. */
    expect(html.match(/admin-badge--warn/g)).toHaveLength(1);
  });

  it('주문을 고르기 전에는 처리 폼을 열지 않는다', () => {
    const html = renderToStaticMarkup(<UnpaidScreen data={consoleData()} now={now} />);

    expect(html).toContain('목록에서 주문을 고르면');
    expect(html).not.toContain('name="memo"');
  });

  it('고른 주문에 확인·연장·취소 세 폼을 붙인다', () => {
    const html = renderToStaticMarkup(
      <UnpaidScreen
        data={consoleData({
          filters: {
            query: '',
            page: 1,
            selectedOrderId: '9a3f21c0-1111-4000-8000-000000000abc',
          },
        })}
        now={now}
      />,
    );

    expect(html).toContain('name="memo"');
    expect(html).toContain('입금 확인');
    expect(html).toContain('기한 24시간 연장');
    expect(html).toContain('즉시 취소');
  });

  /* 연장은 주문당 1회다. 폼이 열려 있으면 운영자가 눌러 보고 실패를 본다. */
  it('이미 연장한 주문은 연장 버튼을 닫는다', () => {
    const html = renderToStaticMarkup(
      <UnpaidScreen
        data={consoleData({
          filters: {
            query: '',
            page: 1,
            selectedOrderId: '55550000-2222-4000-8000-000000000def',
          },
        })}
        now={now}
      />,
    );

    expect(html).toContain('연장 완료 (1회 소진)');
  });

  it('이미 처리된 주문을 고르면 목록으로 돌려보낸다', () => {
    const html = renderToStaticMarkup(
      <UnpaidScreen
        data={consoleData({
          filters: { query: '', page: 1, selectedOrderId: 'gone' },
        })}
        now={now}
      />,
    );

    expect(html).toContain('이미 처리됐을 수 있어요');
  });
});

describe('UnpaidScreen 입금 내역 큐', () => {
  const deposit = {
    id: 'd1',
    source: 'fake',
    externalId: 'dep-001',
    depositedAt: '2026-08-17T23:00:00.000Z',
    depositorName: '홍길동9A3F21C0',
    amount: 23000,
    rawReference: '기업 12345',
    suggestedOrderId: '9a3f21c0-1111-4000-8000-000000000abc',
    suggestedOrderCode: '9A3F21C0',
    suggestedConfidence: 'code_amount',
  };

  it('연동 전에는 큐가 비어 있다고 분명히 말한다', () => {
    const html = renderToStaticMarkup(<UnpaidScreen data={consoleData()} now={now} />);

    expect(html).toContain('미매칭 입금이 없습니다');
  });

  it('제안이 있어도 확정 버튼은 사람이 누르게 둔다', () => {
    const html = renderToStaticMarkup(
      <UnpaidScreen data={consoleData({ deposits: [deposit] })} now={now} />,
    );

    expect(html).toContain('주문코드·금액 일치');
    expect(html).toContain('이 주문으로 확정');
    expect(html).toContain('큐에서 내리기');
  });

  /* 금액이 다른 제안은 부분 입금일 수도, 남의 주문일 수도 있다. */
  it('금액이 다른 제안은 한 번 더 보라고 경고한다', () => {
    const html = renderToStaticMarkup(
      <UnpaidScreen
        data={consoleData({ deposits: [{ ...deposit, suggestedConfidence: 'code' }] })}
        now={now}
      />,
    );

    expect(html).toContain('금액이 다릅니다');
  });

  /* 미아 입금은 지우지 않는다 — 반환 절차의 근거가 이 행이다. */
  it('제안이 없는 입금은 확정 폼 없이 보류 폼만 준다', () => {
    const html = renderToStaticMarkup(
      <UnpaidScreen
        data={consoleData({
          deposits: [{
            ...deposit,
            suggestedOrderId: null,
            suggestedOrderCode: null,
            suggestedConfidence: null,
          }],
        })}
        now={now}
      />,
    );

    expect(html).toContain('대조되는 미입금 주문을 찾지 못했습니다');
    expect(html).not.toContain('이 주문으로 확정');
    expect(html).toContain('큐에서 내리기');
  });
});
