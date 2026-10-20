import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SalesFilterField, SalesFilterPanel, SalesGuide, SalesResultsHeader, SalesSelect, SalesStatusSummary } from './SalesConsole';
import { SalesDateRange } from './SalesDateRange';

describe('sales filter and result forms', () => {
  it('reversed dates keep the input with a linked error and native form constraints', () => {
    const html = renderToStaticMarkup(<SalesDateRange id="dates" from="2026-10-21" to="2026-10-20" />);
    expect(html).toContain('max="2026-10-20"');
    expect(html).toContain('min="2026-10-21"');
    expect(html.match(/aria-invalid="true"/g)).toHaveLength(2);
    expect(html.match(/aria-describedby="dates-range-error"/g)).toHaveLength(2);
    expect(html).toContain('id="dates-range-error" role="alert">시작일은 종료일보다 늦을 수 없습니다.');
  });
  it('same-day and open-ended date searches remain valid', () => {
    const sameDay = renderToStaticMarkup(<SalesDateRange id="same" from="2026-10-20" to="2026-10-20" />);
    const openEnded = renderToStaticMarkup(<SalesDateRange id="open" from="2026-10-20" to={null} />);
    expect(sameDay).not.toContain('aria-invalid');
    expect(openEnded).not.toContain('aria-invalid');
    expect(openEnded).not.toContain('max=');
    expect(openEnded).toContain('min="2026-10-20"');
  });
  it('renders period presets as local form edits and avoids duplicate submitted selectors', () => {
    const html = renderToStaticMarkup(<SalesFilterPanel currentHref="/admin/sales/dispatch?tab=ready&method=parcel&sort=newest&pageSize=50&page=3" id="test"
      now={new Date('2026-10-12T00:00:00Z')} date={{from:null,to:null,field:'ordered',options:[{value:'ordered',label:'주문일'},{value:'paid',label:'결제일'}]}}
      search={{value:'',field:'all',options:[{value:'all',label:'전체'}],placeholder:'검색어'}}>
      <SalesFilterField label="처리상태"><SalesSelect name="tab" value="ready" options={[{value:'ready',label:'발송 대기'}]}/></SalesFilterField>
      <SalesFilterField label="배송방법"><SalesSelect name="method" value="parcel" options={[{value:'parcel',label:'택배'}]}/></SalesFilterField>
    </SalesFilterPanel>);
    expect(html.match(/name="tab"/g)).toHaveLength(1);
    expect(html.match(/name="method"/g)).toHaveLength(1);
    expect(html).toContain('name="sort" value="newest"');
    expect(html).toContain('name="pageSize" value="50"');
    expect(html).not.toContain('name="page"');
    expect(html).toContain('type="button" aria-pressed="false">오늘');
    expect(html).not.toContain('href="/admin/sales/dispatch?tab=ready&amp;method=parcel&amp;sort=newest&amp;pageSize=50&amp;page=1&amp;from=');
  });
  it('applies sorting and list size while preserving the searched scope and dropping selection/page', () => {
    const html = renderToStaticMarkup(<SalesResultsHeader currentHref="/admin/sales/orders?dateField=paid&query=hello&field=recipient&status=shipping&page=9&order=selected&sort=oldest&pageSize=50"
      total={125} pageSize={50} sort="oldest"/>);
    for (const [name, value] of [['dateField','paid'],['query','hello'],['field','recipient'],['status','shipping']]) expect(html).toContain(`name="${name}" value="${value}"`);
    expect(html.match(/name="sort"/g)).toHaveLength(1);
    expect(html.match(/name="pageSize"/g)).toHaveLength(1);
    expect(html).not.toContain('name="page"');
    expect(html).not.toContain('name="order"');
    expect(html).toContain('<option value="50" selected="">50개씩 보기</option>');
  });

  it('keeps the operational guide expanded without submitting or loading any action', () => {
    const html = renderToStaticMarkup(<SalesGuide title="반품 처리 안내"><p>회수 근거를 확인한 뒤 처리합니다.</p></SalesGuide>);
    expect(html).toContain('<details class="admin-sales-guide" open="">');
    expect(html).toContain('회수 근거를 확인한 뒤 처리합니다.');
    expect(html).toContain('메뉴설명 접기');
    expect(html).toContain('메뉴설명 보기');
    expect(html).not.toContain('<form');
  });

  it('preserves all nine claim-stage links and counts when arranging the summary', () => {
    const stages = ['접수', '검토', '회수 중', '회수 완료', '보류', '처리 중', '확인 필요', '완료', '거절'];
    const html = renderToStaticMarkup(<SalesStatusSummary label="단계별 건수" items={stages.map((label, index) => ({
      label, href: `/admin/sales/claims/returns?stage=${index}`, count: index, active: index === 3,
    }))} />);
    expect(html.match(/<a\b/g)).toHaveLength(9);
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    stages.forEach((label, index) => expect(html).toContain(`aria-label="${label} ${index}건"`));
    expect(html).toContain('href="/admin/sales/claims/returns?stage=8"');
  });

  it('does not turn an unavailable summary count into zero', () => {
    const html = renderToStaticMarkup(<SalesStatusSummary label="주문 처리 단계" items={[{label:'전체',href:'/admin/sales/orders',active:true}]} />);
    expect(html).toContain('aria-label="전체"');
    expect(html).not.toContain('<strong>');
    expect(html).not.toContain('0건');
  });
});
