import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PgSettlementPeriodFields } from './PgSettlementPeriodFields';

const tag = (html: string, name: string) => html.match(new RegExp(`<input[^>]*name="${name}"[^>]*>`))?.[0] ?? '';
const render = (from: string, to: string) => renderToStaticMarkup(<PgSettlementPeriodFields from={from} to={to} />);

describe('정산 내역 조회기간', () => {
  it('종료일은 시작일부터 31일 안에서만 고를 수 있고, 제출 이름은 from·to 그대로다', () => {
    const html = render('2026-10-01', '2026-10-31');
    expect(tag(html, 'from')).toContain('type="date"'); expect(tag(html, 'from')).toContain('value="2026-10-01"'); expect(tag(html, 'from')).toContain('required');
    expect(tag(html, 'to')).toContain('min="2026-10-01"'); expect(tag(html, 'to')).toContain('max="2026-10-31"'); expect(tag(html, 'to')).toContain('value="2026-10-31"');
    /* 시작일은 막지 않는다 — 기간을 뒤로 옮길 때 어느 쪽도 먼저 못 바꾸는 순간이 생기지 않게. */
    expect(tag(html, 'from')).not.toMatch(/\smin=|\smax=/);
    expect(html).toContain('최대 31일'); expect(html).not.toContain('role="alert"');
  });
  it('시작일이 달·해를 넘어도 31일 끝을 맞게 계산한다', () => {
    expect(tag(render('2026-12-15', '2026-12-20'), 'to')).toContain('max="2027-01-14"');
    expect(tag(render('2028-02-01', '2028-02-10'), 'to')).toContain('max="2028-03-02"');
  });
  it('31일을 넘거나 시작일이 종료일보다 늦으면 종료일 옆에서 고칠 방법을 말한다', () => {
    const long = render('2026-10-01', '2026-11-05');
    expect(long).toContain('종료일은 시작일부터 31일 안에서 골라 주세요.'); expect(long).toMatch(/role="alert"/);
    expect(tag(long, 'to')).toContain('aria-invalid="true"'); expect(tag(long, 'to')).toContain('aria-describedby="pg-settlement-period-error"');
    const late = render('2026-10-31', '2026-10-01');
    expect(late).toContain('종료일은 시작일과 같거나 그 뒤의 날짜로 골라 주세요.');
  });
  it('날짜가 비어 있으면 제약도 오류도 없고 필수 칸으로 남는다', () => {
    const html = render('', '');
    expect(tag(html, 'to')).not.toMatch(/\smin=|\smax=/); expect(html).not.toContain('role="alert"'); expect(tag(html, 'to')).toContain('required');
  });
});
