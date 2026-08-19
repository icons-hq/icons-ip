import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AdminSettledConsoleData } from '@/lib/admin/settled';
import { SettledScreen } from './SettledScreen';

const ORDER_ID = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-08-18T06:00:00.000Z');

function data(overrides: Partial<AdminSettledConsoleData> = {}): AdminSettledConsoleData {
  return {
    filters: { from: null, to: null, query: '', page: 1 },
    pageSize: 20,
    total: 1,
    rows: [{
      id: ORDER_ID,
      buyerName: 'maple_fan',
      createdAt: '2026-06-01T06:00:00.000Z',
      deliveredAt: '2026-06-10T06:00:00.000Z',
      doneAt: '2026-06-18T06:00:00.000Z',
      total: 57000,
    }],
    ...overrides,
  };
}

describe('SettledScreen', () => {
  it('확정일과 하자 클레임 잔여 기한을 함께 보여준다', () => {
    const html = renderToStaticMarkup(<SettledScreen data={data()} now={NOW} />);

    expect(html).toContain('확정일');
    expect(html).toContain('dateTime="2026-06-18T06:00:00.000Z"');
    // 2026-06-10 + 3개월 = 2026-09-10, 기준 시각까지 23일 남음
    expect(html).toContain('가능 · 23일 남음');
    expect(html).toContain('data-claim-open="true"');
  });

  /* done은 "클레임 불가"가 아니다. 화면이 그 구분을 말하지 않으면 운영자가
     확정됐다는 이유로 정당한 반품 문의를 되돌려 보낸다(#250). */
  it('거래확정이 클레임 종료가 아님을 화면에서 말한다', () => {
    const html = renderToStaticMarkup(<SettledScreen data={data()} now={NOW} />);

    expect(html).toContain('공급받은 날부터 3개월');
    expect(html).toContain('배송완료 8일 뒤 자동');
  });

  it('3개월이 지난 주문은 기한 종료로 표기한다', () => {
    const html = renderToStaticMarkup(
      <SettledScreen data={data()} now={new Date('2026-10-01T06:00:00.000Z')} />,
    );

    expect(html).toContain('기한 종료');
    expect(html).toContain('data-claim-open="false"');
  });

  it('공급일이 없으면 기한 대신 원장 확인을 요구한다', () => {
    const html = renderToStaticMarkup(
      <SettledScreen data={data({
        rows: [{ ...data().rows[0], deliveredAt: null }],
      })} now={NOW} />,
    );

    expect(html).toContain('공급일 미기록 · 원장 확인 필요');
    expect(html).toContain('미기록');
  });

  /* 확정 이후를 되돌리는 조작은 클레임 경로가 맡는다. 선택 체크박스를 두면
     여기서 무언가 처리할 수 있다는 신호가 된다. */
  it('조회 전용이라 선택 체크박스와 일괄 액션이 없다', () => {
    const html = renderToStaticMarkup(<SettledScreen data={data()} now={NOW} />);

    expect(html).not.toContain('aria-label="전체 선택"');
    expect(html).not.toContain('admin-console-bulk-bar');
    expect(html).not.toContain('name="orderIds"');
  });

  it('빈 목록에도 조회 조건과 페이지 요약을 남긴다', () => {
    const html = renderToStaticMarkup(
      <SettledScreen data={data({ rows: [], total: 0 })} now={NOW} />,
    );

    expect(html).toContain('거래확정된 주문이 없습니다.');
    expect(html).toContain('전체 0건');
  });
});
