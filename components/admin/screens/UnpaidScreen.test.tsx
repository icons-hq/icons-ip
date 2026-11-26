import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AdminBankDepositRow, AdminUnpaidConsoleData } from '@/lib/admin/unpaid';
import { formatOrderDateTime } from '@/lib/orders';
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
        recipientName: '홍길동',
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
        recipientName: '김철수',
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
    /* 안내한 입금자명을 그대로 실어야 통장 화면과 눈으로 맞출 수 있다. */
    expect(html).toContain('홍길동9A3F21C0');
    /* 확정이 중간에 멈춘 주문은 상태로 드러나야 한다. */
    expect(html).toContain('입금 대기');
  });

  /*
   * 목록에 주소·연락처를 싣지 않는다. 입금 대조에 필요한 정보가 아니고,
   * 이 화면은 하루 종일 열려 있는 콘솔이다.
   */
  it('연장된 주문을 표시하고 임박한 기한만 강조한다', () => {
    const html = renderToStaticMarkup(<UnpaidScreen data={consoleData()} now={now} />);

    expect(html).toContain('연장됨');
    /* 2시간 남은 주문 하나만 임박이다 — 20시간 남은 주문까지 붉으면 신호가 죽는다. */
    expect(html.match(/data-tone="warning"/g)).toHaveLength(1);
  });

  /* 사람 눈 판정(3·4라운드): 색만 다르면 흰 버튼이 못 누르는 것처럼 보이고, 같은 말이면 눌러도 되는지 망설였다. 모양은 같게, 말로 구분한다. */
  it('기한 종료·결제 확인 필요 줄은 같은 버튼이고 말만 "확인·처리"로 다르다', () => {
    const data = consoleData();
    const link = (row: typeof data.rows[number]) => renderToStaticMarkup(<UnpaidScreen data={{ ...data, rows: [row] }} now={now} />).match(/<a[^>]*#unpaid-actions"[^>]*>[^<]*<\/a>/)?.[0] ?? '';
    expect(link(data.rows[0])).toContain('bg-primary-soft');
    expect(link(data.rows[0])).toContain('>입금 확인<');
    for (const row of [{ ...data.rows[0], expiresAt: '2026-08-17T23:00:00.000Z' }, { ...data.rows[0], attemptState: 'needs_review' as const }]) {
      expect(link(row)).toContain('bg-primary-soft');
      expect(link(row)).toContain('>확인·처리<');
    }
  });

  /* 사람 눈 판정: 제일 급한 기한 종료가 보통 글씨로 지나갔다. */
  it('기한이 끝난 주문은 위험 표시로, 처리는 행마다 버튼으로 연다', () => {
    const data = consoleData();
    const html = renderToStaticMarkup(<UnpaidScreen data={{ ...data, rows: [{ ...data.rows[0], expiresAt: '2026-08-17T23:00:00.000Z' }] }} now={now} />);
    expect(html).toMatch(/data-tone="danger"[^>]*>기한 종료</);
    expect(html).toMatch(/<a[^>]*href="\/admin\/sales\/unpaid\?order=[^"]*#unpaid-actions"[^>]*>확인·처리<\/a>/);
  });

  /*
   * finalizer가 needs_review를 내면 그 주문은 확인도 취소도 특별 경로로만 풀린다.
   * 목록에서 눈에 띄지 않으면 재고를 문 채 조용히 남는다.
   */
  it('정합화가 필요한 주문을 상태로 강조한다', () => {
    const data = consoleData();
    const html = renderToStaticMarkup(
      <UnpaidScreen
        data={{
          ...data,
          rows: [{ ...data.rows[0], attemptState: 'needs_review' }],
        }}
        now={now}
      />,
    );

    expect(html).toContain('결제 확인 필요');
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
    /* 버튼은 '24시간 연장'이 아니라 하는 일 그대로다 — 기한을 누른 시각부터 24시간 뒤로 다시 정한다. */
    expect(html).toContain('기한을 지금부터 24시간 뒤로'); expect(html).not.toContain('기한 24시간 연장');
    expect(html).toContain('즉시 취소');
    /* kit Button은 type이 없으면 button이 된다 — 세 양식 모두 제출 버튼으로 보낸다. */
    for (const label of ['입금 확인', '기한을 지금부터 24시간 뒤로', '즉시 취소']) {
      expect(html).toMatch(new RegExp(`<button[^>]*type="submit"[^>]*>${label}<`));
    }
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

    expect(html).toContain('이미 한 번 연장함');
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
  const deposit: AdminBankDepositRow = {
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

    expect(html).toContain('주문과 연결할 입금이 없습니다');
  });

  it('제안이 있어도 확정 버튼은 사람이 누르게 둔다', () => {
    const html = renderToStaticMarkup(
      <UnpaidScreen data={consoleData({ deposits: [deposit] })} now={now} />,
    );

    expect(html).toContain('주문코드·금액 일치');
    expect(html).toContain('이 주문으로 확정');
    expect(html).toContain('목록에서 내리기');
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>이 주문으로 확정</);
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>목록에서 내리기</);
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

    expect(html).toContain('제안할 미입금 주문을 찾지 못했습니다');
    expect(html).not.toContain('이 주문으로 확정');
    expect(html).toContain('목록에서 내리기');
  });
});

describe('미입금 확인 목록 엑셀 다운로드', () => {
  it('검색어만 담고 선택 주문·페이지는 버린다', () => {
    const html = renderToStaticMarkup(<UnpaidScreen data={consoleData({ filters: { query: '9A3F', page: 3, selectedOrderId: '9a3f21c0-1111-4000-8000-000000000abc' } })} now={now} />);
    expect(html).toContain('목록 엑셀 다운로드');
    expect(html).toContain('data-export-href="/api/admin/list-export?screen=unpaid&amp;q=9A3F"');
  });
});

/* U-04: 이 화면은 회사 계좌 무통장 입금 주문만 보인다. 가상계좌 미입금 주문을 찾으러 온 운영자가 빈 목록만 보고 돌아가지 않게, 접히지 않는 줄에 범위를 말한다. */
describe('UnpaidScreen 범위 안내', () => {
  const html = () => renderToStaticMarkup(<UnpaidScreen data={consoleData()} now={now} />);

  it('회사 계좌 무통장 입금 주문만 보인다는 말과 가상계좌는 자동 확인이라는 말이 접히지 않는 줄에 있다', () => {
    const summary = html().match(/<summary[^>]*>([\s\S]*?)<\/summary>/)?.[1] ?? '';
    expect(summary).toContain('회사 계좌로 받는 무통장 입금 주문만 보여 줍니다.');
    expect(summary).toContain('무통장입금(가상계좌) 주문은 입금되면 자동으로 확인됩니다.');
  });

  it('가상계좌 입금을 기다리는 주문은 주문통합검색의 결제 대기에서 보라고 그 목록으로 잇는다', () => {
    expect(html()).toMatch(/<a[^>]*href="\/admin\/sales\/orders\?[^"]*status=pending[^"]*"[^>]*>주문통합검색의 결제 대기<\/a>/);
  });

  it('목록 이름도 무통장 입금 주문이다', () => {
    expect(html()).toContain('무통장 입금 대기 주문 목록');
    expect(html()).not.toContain('미결제 무통장 주문 목록');
  });
});

/* U-05·U-06: 표의 상태와 결제상태 조건이 같은 이름을 쓰고, 모르는 값은 영문 그대로 내보이지 않는다. */
describe('UnpaidScreen 결제상태 이름', () => {
  const rowWith = (attemptState: string | null) => ({ ...consoleData().rows[0]!, attemptState });
  const render = (attemptState: string | null) => renderToStaticMarkup(<UnpaidScreen data={consoleData({ rows: [rowWith(attemptState)] })} now={now} />);
  const optionLabel = (html: string, value: string) => html.match(new RegExp(`<option[^>]*value="${value}"[^>]*>([^<]*)</option>`))?.[1];

  it.each([
    ['prepared', 'prepared'],
    ['confirming', 'confirming'],
    ['needs_review', 'needs_review'],
    ['unknown', 'unknown'],
    ['missing', null],
  ])('조건 %s의 이름이 그 상태 줄의 표 이름과 같다', (value, attemptState) => {
    const html = render(attemptState);
    const label = optionLabel(html, value);
    expect(label).toBeTruthy();
    expect(html).toMatch(new RegExp(`data-tone="[a-z]+"[^>]*>${label}</`));
  });

  it('조건의 이름은 서로 다르다(같은 이름으로 두 조건을 만들지 않는다)', () => {
    const html = render('prepared');
    const labels = ['', 'prepared', 'confirming', 'needs_review', 'unknown', 'missing'].map((value) => optionLabel(html, value));
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels).toEqual(['전체', '입금 대기', '입금 확인 처리 중', '결제 확인 필요', '결과 미확인', '결제 기록 없음']);
  });

  it('모르는 상태값은 영문 그대로가 아니라 확인 필요로 보인다', () => {
    const html = render('declined');
    expect(html).not.toContain('declined');
    expect(html).toMatch(/data-tone="[a-z]+"[^>]*>확인 필요</);
  });
});

/* U-02: 처리 패널은 표 아래에 있어 고른 줄과 떨어져 있다. 머리에서 어느 주문인지(통장과 맞춰 볼 값)를 말한다. */
describe('UnpaidScreen 처리 패널 머리', () => {
  const ORDER = '9a3f21c0-1111-4000-8000-000000000abc';
  const NUMBER = '20261126140710000001';
  const render = (overrides: Partial<AdminUnpaidConsoleData['rows'][number]> = {}, selectedOrderId: string | null = ORDER) => {
    const data = consoleData({ filters: { query: '', page: 1, selectedOrderId } });
    data.rows[0] = { ...data.rows[0]!, orderNumber: NUMBER, ...overrides };
    const html = renderToStaticMarkup(<UnpaidScreen data={data} now={now} />);
    return html.slice(html.indexOf('id="unpaid-actions"'));
  };
  const text = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

  it('주문번호·구매자·안내된 입금자명·입금액·입금 기한을 머리에 말한다', () => {
    const panel = text(render());
    expect(panel).toContain(`주문 ${NUMBER} 처리`);
    expect(panel).toMatch(/구매자 홍길동/);
    expect(panel).toMatch(/안내된 입금자명 홍길동9A3F21C0/);
    expect(panel).toMatch(/입금액 ₩23,000/);
    expect(panel).toContain(`입금 기한 (KST) ${formatOrderDateTime('2026-08-18T02:00:00.000Z')}`);
    expect(panel).toContain('2시간 0분 남음');
    expect(panel).toMatch(/입금확인코드 9A3F21C0/);
    expect(panel).toMatch(/품목 무통장 굿즈 × 1/);
  });

  it('임박한 기한은 강조하고 연장한 주문은 연장됨을 붙인다', () => {
    expect(render()).toMatch(/data-tone="warning"[^>]*>2시간 0분 남음</);
    expect(text(render({ extendedAt: '2026-08-17T23:00:00.000Z' }))).toContain('연장됨');
    expect(render({ expiresAt: '2026-08-17T23:00:00.000Z' })).toMatch(/data-tone="danger"[^>]*>기한 종료</);
  });

  it('주문번호가 없는 옛 주문은 입금확인코드로 가리킨다(내부 번호를 내보이지 않는다)', () => {
    const panel = text(render({ orderNumber: undefined }));
    expect(panel).toContain('입금확인코드 9A3F21C0 주문 처리');
    expect(panel).not.toContain(ORDER);
  });

  it('기한을 모르는 줄은 그렇게 말한다', () => {
    expect(text(render({ expiresAt: null }))).toContain('입금 기한 (KST) 기한 정보 없음');
  });

  it('근거·사유 칸은 필수이고 5자 이상이라고 알리며, 글 안내는 한 줄이다', () => {
    const panel = render();
    for (const label of ['입금 근거 (필수)', '기한 연장 사유 (필수)', '취소 사유 (필수)']) expect(panel).toContain(label);
    expect(panel.match(/minLength="5"/g)).toHaveLength(3);
    expect(text(panel)).toContain('근거·사유는 5자 이상 적어야 하고 감사 기록에 남습니다.');
    /* 취소·환불 안내는 확인창으로 옮겼다 — 패널에 같은 말을 되풀이하지 않는다. */
    expect(panel).not.toContain('미입금 취소는 환불이 없습니다');
  });
});

/* 입금 확인은 결제 시도가 '입금 대기'일 때만 된다(DB가 그 밖의 상태는 거절한다). 못 누르는 버튼은 이유와 함께 닫는다. */
describe('UnpaidScreen 입금 확인을 못 누르는 주문', () => {
  const ORDER = '9a3f21c0-1111-4000-8000-000000000abc';
  const panelFor = (attemptState: string | null) => {
    const data = consoleData({ filters: { query: '', page: 1, selectedOrderId: ORDER } });
    data.rows[0] = { ...data.rows[0]!, attemptState };
    const html = renderToStaticMarkup(<UnpaidScreen data={data} now={now} />);
    return html.slice(html.indexOf('id="unpaid-actions"'));
  };
  const confirmButton = (panel: string) => panel.match(/<button[^>]*type="submit"[^>]*>입금 확인<\/button>/)?.[0] ?? '';

  it('입금 대기이면 누를 수 있고 이유 줄이 없다', () => {
    const panel = panelFor('prepared');
    /* 버튼 모양 클래스에도 'disabled:'가 들어 있어, 닫힌 버튼은 속성(disabled="")으로 가린다. */
    expect(confirmButton(panel)).not.toMatch(/ disabled=""/);
    expect(panel).not.toContain('입금 확인은');
  });

  it.each([
    ['needs_review', '결제 확인 필요'],
    ['unknown', '결과 미확인'],
    ['confirming', '입금 확인 처리 중'],
    [null, '결제 기록 없음'],
  ])('%s이면 입금 확인 버튼을 닫고 지금 상태와 주문 상세로 가는 길을 말한다', (attemptState, label) => {
    const panel = panelFor(attemptState);
    expect(confirmButton(panel)).toMatch(/ disabled=""/);
    expect(panel).toContain(`입금 확인은 ‘입금 대기’일 때만 누를 수 있습니다. 지금은 ‘${label}’입니다.`);
    expect(panel).toMatch(new RegExp(`<a[^>]*href="/admin/sales/orders/${ORDER}"[^>]*>주문 상세</a>`));
    /* 취소는 이 상태에서도 할 수 있다(결제 확인 필요·결과 미확인 주문을 정리하는 길이다). */
    expect(panel).toMatch(/<button[^>]*type="submit"[^>]*>즉시 취소<\/button>/);
  });
});

/* 입금 확인·즉시 취소 직후 주문은 이 목록에서 빠진다. 그때 결과를 어디서 보는지 말한다. */
describe('UnpaidScreen 처리된 주문 안내', () => {
  it('고른 주문이 목록에 없으면 주문 상세에서 결과를 볼 수 있게 잇는다', () => {
    const id = '11111111-2222-4333-8444-555555555555';
    const html = renderToStaticMarkup(<UnpaidScreen data={consoleData({ filters: { query: '', page: 1, selectedOrderId: id } })} now={now} />);
    expect(html).toContain('이미 처리됐을 수 있어요');
    expect(html).toMatch(new RegExp(`<a[^>]*href="/admin/sales/orders/${id}"[^>]*>주문 상세에서 처리 결과 확인</a>`));
  });

  it('주문 번호 꼴이 아닌 값이면 상세로 잇지 않는다', () => {
    const html = renderToStaticMarkup(<UnpaidScreen data={consoleData({ filters: { query: '', page: 1, selectedOrderId: 'gone' } })} now={now} />);
    expect(html).toContain('이미 처리됐을 수 있어요');
    expect(html).not.toContain('주문 상세에서 처리 결과 확인');
  });
});
