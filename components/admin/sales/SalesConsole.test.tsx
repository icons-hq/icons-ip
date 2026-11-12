import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SalesDisclosureCard, SalesFilterField, SalesFilterPanel, SalesGuide, SalesResultsHeader, SalesSelect, SalesStatusSummary, ShortId, kstDayDiff } from './SalesConsole';
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
    /* kit 입력의 클래스에는 aria-invalid: 변형 이름이 들어 있다 — 속성만 본다. */
    expect(sameDay).not.toContain('aria-invalid=');
    expect(sameDay).not.toContain('role="alert"');
    expect(openEnded).not.toContain('aria-invalid=');
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
    /* kit Button은 type이 없으면 button이 된다 — 검색은 GET 폼을 제출해야 한다. */
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>검색</);
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
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>적용</);
  });

  it('날짜 차이는 24시간 단위가 아니라 한국 달력으로 센다', () => {
    const at = (iso: string) => Date.parse(iso);
    /* 2026-11-09 23:30 KST → 2026-11-10 00:30 KST: 1시간 뒤지만 다음 날이다. */
    expect(kstDayDiff(at('2026-11-09T14:30:00Z'), at('2026-11-09T15:30:00Z'))).toBe(1);
    /* 2026-11-09 00:10 KST → 2026-11-09 23:50 KST: 거의 24시간이지만 같은 날이다. */
    expect(kstDayDiff(at('2026-11-08T15:10:00Z'), at('2026-11-09T14:50:00Z'))).toBe(0);
    expect(kstDayDiff(at('2026-11-10T00:00:00Z'), at('2026-11-09T00:00:00Z'))).toBe(-1);
  });

  it('긴 식별값은 줄마다 달라지는 끝 8자를 보이고 전체 값은 title에 둔다', () => {
    const html = renderToStaticMarkup(<ShortId value="c0000054-0000-4000-8000-00000000a1b2" />);
    expect(html).toContain('>0000A1B2<');
    expect(html).toContain('title="c0000054-0000-4000-8000-00000000a1b2"');
  });
  it('자주 쓰지 않는 조건은 접어 두되 값이 걸려 있으면 펼치고, 접혀도 입력은 검색에 함께 간다', () => {
    const panel = (moreActive: boolean) => renderToStaticMarkup(<SalesFilterPanel currentHref="/admin/sales/orders" id="f" search={{ value: '', placeholder: '번호 · 이름' }} moreActive={moreActive} more={<SalesFilterField label="결제수단" htmlFor="pay"><SalesSelect id="pay" name="paymentMethod" options={[{ value: '', label: '전체' }]} /></SalesFilterField>} />);
    const closed = panel(false);
    expect(closed).toContain('name="paymentMethod"');
    expect(closed).toMatch(/class="hidden"[^>]*data-sales-more-filters=""/);
    expect(closed).toContain('aria-expanded="false"');
    expect(panel(true)).toContain('aria-expanded="true"');
    /* 한 줄로 끝나도록 입력칸 아래 안내는 눈에서 감추고 도움말로 둔다. */
    expect(closed).toMatch(/class="sr-only"[^>]*>번호 · 이름</);
    expect(closed).toContain('title="번호 · 이름"');
  });
  /* QA1 S-T06-02: 주문통합검색 검색칸이 좁아 20자리 주문번호가 앞 15자리만 보였다. 번호 검색 화면은 20자리가 다 보이는 폭을 지킨다. */
  it('주문번호 검색칸은 20자리가 다 보이는 폭을 지키고, 다른 화면의 검색칸은 그대로다', () => {
    const options = [{ value: 'all', label: '전체' }, { value: 'order', label: '주문번호' }];
    const wide = renderToStaticMarkup(<SalesFilterPanel currentHref="/admin/sales/orders" id="w" more={<span />}
      search={{ value: '20261112140010000034', field: 'all', options, placeholder: '검색어 입력', fitsOrderNumber: true }} />);
    const input = wide.match(/<input id="w-query"[^>]*>/)?.[0] ?? '';
    expect(input).toContain('min-w-[min(100%,calc(20ch_+_3rem))]');
    expect(input).not.toContain('min-w-0');
    expect(wide).toContain('min-w-[min(100%,calc(20ch_+_11.25rem))]');
    expect(wide).toContain('value="20261112140010000034"');
    const plain = renderToStaticMarkup(<SalesFilterPanel currentHref="/admin/sales/dispatch" id="p" more={<span />}
      search={{ value: '', field: 'all', options, placeholder: '검색어 입력' }} />);
    expect(plain).not.toContain('20ch');
    expect(plain).toContain('min-w-[min(100%,17rem)]');
  });
  it('keeps the operational guide folded by default without submitting or loading any action', () => {
    const html = renderToStaticMarkup(<SalesGuide title="반품 처리 안내"><p>회수 근거를 확인한 뒤 처리합니다.</p></SalesGuide>);
    expect(html).toMatch(/<details [^>]*data-sales-guide=""/);
    expect(html).not.toMatch(/<details [^>]*data-sales-guide=""[^>]*open=""/);
    expect(html).toContain('회수 근거를 확인한 뒤 처리합니다.');
    expect(html).toContain('메뉴설명 접기');
    expect(html).toContain('메뉴설명 보기');
    expect(html).not.toContain('<form');
  });

  it('접히는 카드는 닫힌 채로 그리고 안의 입력을 DOM에 남긴다', () => {
    const html = renderToStaticMarkup(<SalesDisclosureCard title="자동 발주확인" status={<b>켜짐</b>} summary="매일 16:30"><input name="runTime" /></SalesDisclosureCard>);
    expect(html).toMatch(/<details (?:(?!open)[^>])*data-sales-disclosure=""(?:(?!open)[^>])*>/);
    expect(html).toContain('자동 발주확인');
    expect(html).toContain('매일 16:30');
    expect(html).toContain('name="runTime"');
    expect(html).toContain('설정 펼치기');
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
    expect(html).not.toContain('<strong');
    expect(html).not.toContain('0건');
  });
});
