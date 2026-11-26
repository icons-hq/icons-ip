import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GoodsOptionEditor } from './GoodsOptionEditor';

const savedA = '11111111-1111-4111-8111-111111111111';
const savedB = '22222222-2222-4222-8222-222222222222';

describe('상품 옵션 ERP 식별자 입력', () => {
  it('세 번째 옵션 축과 적용 전 입력을 숨김 없이 복구한다', () => {
    const html = renderToStaticMarkup(<GoodsOptionEditor onRowsChange={() => {}} baseline={[savedA]} basePrice={1000}
      rows={[{ id: savedA, name: '빨강 / M / 기본', code: 'THREE-01', attributes: { 색상: '빨강', 크기: 'M', 구성: '기본' }, extraPrice: 0, stockQty: 3 }]}
      axisValues={{ optionAxisName2: '포장', optionAxisValues2: '기본, 선물' }} />);
    /* 옵션명이 3개까지인 이유와 더 필요할 때의 방법은 제목과 세 번째 옵션명 옆 "?"에 있다(늘 보이던 '옵션명 최대 3개' 글은 뺐다). */
    expect(html).not.toContain('옵션명 최대 3개');
    expect(html).toContain('aria-label="옵션명과 옵션값 도움말"');
    expect(html).toContain('aria-label="옵션명 3 (선택) 도움말"');
    for (const other of ['옵션명 1 도움말', '옵션명 2 (선택) 도움말']) expect(html).not.toContain(other);
    expect(html).toContain('name="optionAxisName2" value="포장"');
    expect(html).toContain('name="optionAxisValues2" value="기본, 선물"');
    expect(html).toContain('옵션값 3 (쉼표로 구분)');
    expect(html).toContain('&quot;구성&quot;:&quot;기본&quot;');
  });
  it('renders separate ERP fields and carries their values in the option payload', () => {
    const html = renderToStaticMarkup(<GoodsOptionEditor onRowsChange={() => {}}
      rows={[{
        id: savedA, name: '기본 옵션', code: 'OWN-01', attributes: {},
        extraPrice: 0, stockQty: 2, erpCode: '0000123', erpName: 'ERP 품명', barcode: '0007',
        externalUpdatedAt: '2026-09-10T07:00:00.000Z',
      }]}
      baseline={[savedA]}
      basePrice={1000}
    />);
    for (const label of ['ERP 코드', 'ERP 품명', '바코드', '0000123', 'ERP 품명', '0007']) expect(html).toContain(label);
    expect(html).toContain('aria-label="옵션 1 ERP 품명"');
    /* 저장된 ERP 값은 직접 적은 것과 같은 입력 칸으로 보이고, 이번에 고른 품목이 아니므로 고른 품목 표시는 없다. */
    expect(html).toMatch(/aria-label="옵션 1 ERP 품명"[^>]*value="ERP 품명"/);
    expect(html).not.toContain('data-good-option-erp-picked');
    expect(html).toContain('&quot;erpCode&quot;:&quot;0000123&quot;');
    expect(html).toContain('&quot;externalUpdatedAt&quot;:&quot;2026-09-10T07:00:00.000Z&quot;');
  });

  /* 2026-11-19 MD가 받은 엑셀의 '코드'(ERP 코드)를 옛 '관리코드' 칸에 넣었다. 어느 칸에 무엇을 넣고 어느 엑셀에 찍히는지는 그 칸에서 보이고
     (머리글 아래 작은 줄·입력칸 예시·잠긴 자동코드), ERP 코드·바코드 칸이 옵션 자동코드보다 앞에 온다. 2026-11-25 '글보다 화면':
     네 줄 안내 문단은 빼고, 이름이 비슷해 헷갈리는 ERP 코드·옵션 자동코드에만 "?"를 단다. ERP 품명 칸은 제안 목록 없이 직접 적는 칸이고,
     ERP 품목은 줄 맨 앞의 [ERP 품목 고르기]에서 고른다(화면 규칙 1). */
  it('옵션 상세 정보는 사람이 넣는 ERP 코드·바코드를 자동코드보다 앞에 두고 넣을 값과 찍히는 엑셀을 그 칸에서 보인다', () => {
    const rows = [{ id: savedA, name: '기본 옵션', code: '', attributes: {}, extraPrice: 0, stockQty: 1 }];
    const html = renderToStaticMarkup(<GoodsOptionEditor onRowsChange={() => {}} rows={rows} baseline={[savedA]} basePrice={1000} canSearchErp />);
    const details = html.slice(html.indexOf('data-good-option-details'));
    const headers = [...details.slice(0, details.indexOf('</thead>')).matchAll(/<th[^>]*scope="col"[^>]*>(.*?)<\/th>/g)]
      .map((match) => match[1].replace(/<span[^>]*>.*?<\/span>/g, '').replace(/<[^>]+>/g, ''));
    expect(headers).toEqual(['옵션', 'ERP 코드', '바코드', 'ERP 품명', '옵션 자동코드', '안전재고 기준']);
    const cells = [...details.matchAll(/<input[^>]*aria-label="(옵션 자동코드|옵션 1 (?:ERP 코드|바코드|ERP 품명|안전재고 기준))"/g)].map((match) => match[1]);
    expect(cells).toEqual(['옵션 1 ERP 코드', '옵션 1 바코드', '옵션 1 ERP 품명', '옵션 자동코드', '옵션 1 안전재고 기준']);
    /* 늘 보이던 안내 문단(목록)은 없다. 헷갈리는 세 칸의 머리글에만 "?"가 있다. */
    expect(details).not.toContain('goods-option-external-identity-guidance');
    expect(details).not.toContain('data-good-option-guidance');
    expect([...details.matchAll(/aria-label="([^"]+) 도움말"/g)].map((match) => match[1])).toEqual(['ERP 코드', '옵션 자동코드']);
    for (const retired of ['role="combobox"', 'role="listbox"', '이름으로 검색']) expect(details, retired).not.toContain(retired);
    expect(details).toMatch(/aria-label="옵션 1 ERP 품명"[^>]*placeholder="ERP 상품 이름"/);
    /* 고르는 버튼은 손으로 적는 세 칸보다 앞(옵션 이름 아래)에 있고, 폼을 제출하지 않는 버튼이다. */
    expect(details).toMatch(/<button type="button"[^>]*data-erp-item-picker=""[^>]*aria-label="ERP 품목 고르기"[^>]*>ERP 품목 고르기<\/button>/);
    expect(details.indexOf('data-erp-item-picker=""')).toBeLessThan(details.indexOf('aria-label="옵션 1 ERP 코드"'));
    expect(details.indexOf('aria-label="옵션 이름"')).toBeLessThan(details.indexOf('data-erp-item-picker=""'));
    /* 고르기 전에는 고른 품목 표시도 선택창도 없다. */
    expect(details).not.toContain('data-good-option-erp-picked');
    expect(details).not.toContain('data-admin-picker');
    expect(details.match(/직접 입력 · 거래확정·출고 엑셀에 찍힘/g)).toHaveLength(2);
    expect(details).toMatch(/aria-label="옵션 1 바코드"[^>]*placeholder="엑셀의 &#x27;바코드&#x27;"/);
    expect(details).toMatch(/aria-label="옵션 1 안전재고 기준"[^>]*placeholder="비우면 알림 없음"/);
    /* 시스템이 만드는 옵션 자동코드는 기본으로 잠그고 자동 생성임을 보인다(ADR-0048). */
    expect(details).toMatch(/<input[^>]*aria-label="옵션 자동코드"[^>]*placeholder="저장 시 자동 생성"/);
    expect(details).toMatch(/<input(?=[^>]*aria-label="옵션 자동코드")[^>]*readOnly=""/);
    expect(details).toContain('자동 생성 · 입력할 필요 없음');
    expect(details).toContain('>옵션 자동코드 직접 바꾸기</button>');
    expect(details).toMatch(/aria-label="옵션 1 ERP 코드"[^>]*placeholder="엑셀의 &#x27;코드&#x27;"/);
    for (const jargon of ['반입', '선행 0', '미설정', '관리코드']) expect(details, jargon).not.toContain(jargon);
  });

  /* 1027T-016: ERP 품목을 찾는 일은 상품 관리 권한으로 연다. 권한이 없으면 고르는 버튼만 빠지고 세 칸은 그대로 직접 적는다. */
  it('ERP 품목을 찾을 수 없는 운영자에게는 고르는 버튼을 보이지 않고 직접 적는 칸만 둔다', () => {
    const rows = [{ id: savedA, name: '기본 옵션', code: '', attributes: {}, extraPrice: 0, stockQty: 1 }];
    const html = renderToStaticMarkup(<GoodsOptionEditor onRowsChange={() => {}} rows={rows} baseline={[savedA]} basePrice={1000} canSearchErp={false} />);
    expect(html).not.toContain('data-erp-item-picker');
    expect(html).not.toContain('ERP 품목 고르기');
    for (const label of ['옵션 1 ERP 코드', '옵션 1 바코드', '옵션 1 ERP 품명']) expect(html).toMatch(new RegExp(`<input(?![^>]* (?:readOnly|disabled)="")[^>]*aria-label="${label}"`));
  });

  /* 공개 중(옵션 구성 잠금)·그룹 공통정보 잠금에서도 ERP 코드·바코드·ERP 품명과 고르는 버튼은 열려 있다(지금까지와 같다). */
  it('옵션 구성이 잠겨 있어도 ERP 정보는 고르거나 적을 수 있다', () => {
    const rows = [
      { id: savedA, name: '빨강', code: 'LOCK-01', attributes: { 색상: '빨강' }, extraPrice: 0, stockQty: 3 },
      { id: savedB, name: '파랑', code: 'LOCK-02', attributes: { 색상: '파랑' }, extraPrice: 0, stockQty: 5 },
    ];
    for (const lock of [{ compositionLockedReason: '공개 중에는 옵션을 더하거나 뺄 수 없습니다.' }, { structureLocked: true }]) {
      const html = renderToStaticMarkup(<GoodsOptionEditor onRowsChange={() => {}} rows={rows} baseline={[savedA, savedB]} basePrice={1000} {...lock} />);
      const details = html.slice(html.indexOf('data-good-option-details'));
      expect(details.match(/<button type="button"(?![^>]* disabled="")[^>]*data-erp-item-picker=""/g)).toHaveLength(2);
      for (const label of ['옵션 1 ERP 코드', '옵션 1 바코드', '옵션 1 ERP 품명']) expect(details, label).toMatch(new RegExp(`<input(?![^>]* (?:readOnly|disabled)="")[^>]*aria-label="${label}"`));
      /* 옵션 상세 정보 표는 잠금 fieldset 바깥이다(앞에서 연 fieldset은 모두 닫혀 있다). */
      const before = html.slice(0, html.indexOf('data-good-option-details'));
      expect(before.match(/<fieldset/g)?.length).toBeGreaterThan(0);
      expect(before.match(/<fieldset/g)?.length).toBe(before.match(/<\/fieldset>/g)?.length);
    }
  });

  it('잠긴 옵션 자동코드에 바코드 형식 값이 들어 있으면 바코드 칸으로 경고만 한다', () => {
    const html = renderToStaticMarkup(<GoodsOptionEditor onRowsChange={() => {}}
      rows={[
        { id: savedA, name: '홍기훈', code: '8800353086155', attributes: { 캐릭터: '홍기훈' }, extraPrice: 0, stockQty: 2, barcode: '8800353086155' },
        { id: savedB, name: '이연', code: 'HSQ-0033-01', attributes: { 캐릭터: '이연' }, extraPrice: 0, stockQty: 2, barcode: '8800353086148' },
      ]}
      baseline={[savedA, savedB]}
      basePrice={1000}
    />);
    expect(html.match(/data-good-option-code-barcode=/g)).toHaveLength(1);
    expect(html).toContain('바코드 형식입니다 · 바코드는 바코드 칸에 넣습니다');
    expect(html).toMatch(/<input(?=[^>]*aria-label="옵션 1 옵션 자동코드")(?=[^>]*readOnly)(?=[^>]*aria-describedby="goods-option-code-barcode-0")/);
    expect(html).not.toMatch(/<input(?=[^>]*aria-label="옵션 2 옵션 자동코드")(?=[^>]*aria-describedby)/);
  });

  it('옵션 없는 상품은 재고수량 입력 하나와 옵션 자동코드만 보이고 옵션 없음이 골라져 있다', () => {
    const html = renderToStaticMarkup(<GoodsOptionEditor onRowsChange={() => {}}
      rows={[{
        id: savedA, name: '기본 옵션', code: 'GOOD-0001', attributes: {},
        extraPrice: 0, stockQty: 8, lowStockThreshold: 2, isActive: true,
        erpCode: '0000123', erpName: 'ERP 품명', barcode: '0007',
      }]}
      baseline={[savedA]}
      basePrice={10000}
    />);

    expect(html).toContain('data-option-mode="single"');
    expect(html).toMatch(/<label class="[^"]*" for="goods-single-stock">재고수량 \(필수\)<\/label>/);
    /* 2026-11-25 '글보다 화면': 늘 보이던 재고 안내 문단은 없다. 무엇인지와 옵션을 만들 때의 주의는 "?"에, 비웠을 때 넣을 값은 빈 칸에 보인다. */
    expect(html).not.toContain('엑스스퀘어에서 판매할 수량이며');
    expect(html).not.toContain('goods-option-stock-guidance');
    expect(html).toContain('aria-label="재고수량 (필수) 도움말"');
    const stock = html.match(/<input[^>]*id="goods-single-stock"[^>]*>/)?.[0] ?? '';
    expect(stock).toContain('value="8"'); expect(stock).toContain('required=""');
    /* 옵션 있음/없음은 이름과 한 줄 설명이 있는 선택 카드 두 장이다. 폼 name·value(optionUsage on/off)는 그대로다. */
    expect(html).toMatch(/<fieldset[^>]*data-good-choice="cards"[^>]*data-good-option-usage=""/);
    expect(html).toMatch(/<input type="radio" name="optionUsage" checked="" value="off"\/>옵션 없음<\/span><span[^>]*>한 가지로만 파는 상품<\/span>/);
    expect(html).toMatch(/<input type="radio" name="optionUsage" value="on"\/>옵션 있음<\/span><span[^>]*>색상·사이즈처럼 골라서 사는 상품<\/span>/);
    expect(html).toContain('aria-label="옵션 이름"');
    expect(html).toContain('GOOD-0001');
    expect(html).not.toContain('>옵션가</label>');
    expect(html).not.toContain('>사용여부</label>');
    expect(html).not.toContain('aria-label="옵션목록 편집표"');
    /* 같은 대상을 한 이름으로만 부른다: 화면 이름에 설정함·설정안함·기본 옵션(저장된 줄 이름 값은 제외)·보관을 쓰지 않는다. */
    const labels = html.replace(/value="[^"]*"/g, '');
    for (const mixed of ['설정안함', '설정함', '기본 옵션', '보관']) expect(labels, mixed).not.toContain(mixed);
    for (const legacy of ['기준 판매가', '추가금액', '옵션 판매가', '할당 재고', '조합 생성']) expect(html).not.toContain(legacy);
  });

  /* 0901-015(11/11 결정 "비우면 저장 불가"): 새 재고 칸은 빈 값이고 필수 입력이다. 옵션목록의 새 옵션도 같다. 0은 값으로 보인다. */
  it('새 재고 칸은 0을 미리 채우지 않고 빈 필수 입력으로 시작하며, 0을 넣으면 0으로 보인다', () => {
    const empty = renderToStaticMarkup(<GoodsOptionEditor onRowsChange={() => {}} baseline={[]} basePrice={10000}
      rows={[{ name: '기본 옵션', code: '', attributes: {}, extraPrice: 0, stockQty: Number.NaN }]} />);
    const input = (html: string, pattern: string) => html.match(new RegExp(`<input[^>]*${pattern}[^>]*>`))?.[0] ?? '';
    const blank = input(empty, 'id="goods-single-stock"');
    for (const attribute of ['value=""', 'required=""', 'placeholder="없으면 0"']) expect(blank).toContain(attribute);
    expect(empty).toContain('&quot;stockQty&quot;:null');
    const zero = renderToStaticMarkup(<GoodsOptionEditor onRowsChange={() => {}} baseline={[]} basePrice={10000}
      rows={[{ name: '기본 옵션', code: '', attributes: {}, extraPrice: 0, stockQty: 0 }]} />);
    expect(input(zero, 'id="goods-single-stock"')).toContain('value="0"');
    const options = renderToStaticMarkup(<GoodsOptionEditor onRowsChange={() => {}} baseline={[]} basePrice={10000} axisValues={{ optionUsage: 'on' }}
      rows={[{ name: '빨강', code: '', attributes: { 색상: '빨강' }, extraPrice: 0, stockQty: 3 }, { name: '파랑', code: '', attributes: { 색상: '파랑' }, extraPrice: 0, stockQty: Number.NaN }]} />);
    expect(input(options, 'aria-label="옵션 1 재고수량"')).toContain('value="3"');
    expect(input(options, 'aria-label="옵션 2 재고수량"')).toContain('value=""');
    expect(input(options, 'aria-label="옵션 2 재고수량"')).toContain('required=""');
  });

  /* 2026-10-07 리뷰: 중지된 기본 옵션만 남은 상품은 옵션 미사용 화면에서 사용여부를 되돌릴 칸이 없었다. */
  it('사용 중지된 옵션 하나만 남은 옵션 없는 상품은 그 화면에서 사용여부를 바꿀 수 있다', () => {
    const html = renderToStaticMarkup(<GoodsOptionEditor onRowsChange={() => {}}
      rows={[{ id: savedA, name: '기본 옵션', code: 'GOOD-0001', attributes: {}, extraPrice: 0, stockQty: 8, isActive: false }]}
      baseline={[savedA]} basePrice={10000} />);
    expect(html).toContain('for="goods-single-active">사용여부</label>');
    expect(html).toMatch(/<select[^>]*id="goods-single-active"[^>]*>/);
    /* 옵션의 이 상태는 어디서나 '사용 중지'다('중지'·'보관'으로 부르지 않는다). */
    expect(html).toContain('<option value="stopped" selected="">사용 중지</option>');
    expect(html).toContain('사용 중지하면 고객이 살 수 없습니다. 주문 기록과 재고는 그대로 남습니다.');
    expect(html).toContain('모든 옵션이 사용 중지되어 고객이 구매할 수 없습니다.');
  });

  it('옵션가가 남아 있는 옵션 없는 상품은 그 금액과 판매 금액을 함께 보여준다', () => {
    const html = renderToStaticMarkup(<GoodsOptionEditor onRowsChange={() => {}}
      rows={[{ id: savedA, name: '기본 옵션', code: 'GOOD-0001', attributes: {}, extraPrice: 1500, stockQty: 8 }]}
      baseline={[savedA]} basePrice={10000} />);
    expect(html).toContain('for="goods-single-extra-price">옵션가</label>');
    expect(html).toContain('aria-label="옵션가 도움말"');
    expect(html).toContain('판매 11,500원');
  });

  it('옵션목록은 스마트스토어 순서의 열과 금액 열 하나, 선택목록 일괄수정을 둔다', () => {
    const html = renderToStaticMarkup(<GoodsOptionEditor onRowsChange={() => {}}
      rows={[
        { id: savedA, name: '빨강', code: 'GOOD-01', attributes: { 색상: '빨강' }, extraPrice: 0, stockQty: 4, isActive: true },
        { id: savedB, name: '파랑', code: 'GOOD-02', attributes: { 색상: '파랑' }, extraPrice: 1000, stockQty: 5, isActive: false },
      ]}
      baseline={[savedA, savedB]}
      basePrice={10000}
    />);

    expect(html).toContain('data-option-mode="multiple"');
    expect(html).toMatch(/<input type="radio" name="optionUsage" checked="" value="on"\/>옵션 있음/);
    expect(html).toContain('옵션목록 (총 2개)');
    const table = html.slice(html.indexOf('aria-label="옵션목록 편집표"'));
    const headers = [...table.slice(0, table.indexOf('</thead>')).matchAll(/<th[^>]*scope="col"[^>]*>(.*?)<\/th>/g)].map((match) => match[1].replace(/<[^>]+>/g, ''));
    /* 옵션 자동코드는 옵션 상세 정보로 옮겼다(표 폭을 줄이는 복잡도 표 137행). 옵션값을 짝지은 한 줄의 열 이름은 '옵션'이다 — '옵션명'은 색상·사이즈 같은 기준 이름에만 쓴다. */
    expect(headers).toEqual(['선택', '옵션', '옵션가', '재고수량', '사용여부', '순서', '삭제']);
    /* 옵션가가 무엇인지는 머리글 "?"와 줄마다의 판매 금액이 말한다(제목 옆 회색 설명은 뺐다). */
    expect(html).toContain('aria-label="옵션가 도움말"');
    expect(html).not.toContain('옵션가는 판매가(할인하면 할인가)에 더하는 금액입니다.');
    expect(html).toContain('판매 10,000원');
    expect(html).toContain('판매 11,000원');
    expect(html).toContain('옵션 재고수량 합계');
    expect(html).toContain('9개');
    expect(html).toContain('사용 중인 옵션만 4개');
    expect(html).not.toContain('옵션목록에서 옵션별로 입력합니다.');
    /* 사용 중지로 둔 옵션은 저장하면 어디로 가는지 그 줄에서 알린다. */
    expect(html).toContain('사용 중지 · 저장하면 아래 &#x27;옵션 사용 중지·다시 사용&#x27;으로 옮겨집니다');
    expect(html).toContain('<option value="stopped" selected="">사용 중지</option>');
    expect(html).not.toContain('>중지</option>');
    for (const label of ['선택목록 일괄수정', '선택삭제']) expect(html).toMatch(new RegExp(`<button type="button"[^>]*disabled=""[^>]*>${label}</button>`));
    expect(html.indexOf('옵션목록 편집표')).toBeLessThan(html.indexOf('옵션 상세 정보 · ERP 코드·바코드·ERP 품명·옵션 자동코드·안전재고'));
    expect(html).toContain('GOOD-01');
    expect(html).toContain(savedB);
    /* 옵션 상세 정보의 줄마다 [ERP 품목 고르기]가 하나씩 있고, 어느 옵션의 버튼인지는 읽어 주는 이름으로 구분한다. */
    expect([...html.matchAll(/data-erp-item-picker=""[^>]*aria-label="([^"]+)"/g)].map((match) => match[1])).toEqual(['옵션 1 ERP 품목 고르기', '옵션 2 ERP 품목 고르기']);
    expect(html.match(/>ERP 품목 고르기<\/button>/g)).toHaveLength(2);
    for (const legacy of ['기준 판매가', '추가금액', '옵션 판매가', '할당 재고', '조합 생성']) expect(html).not.toContain(legacy);
  });

  /* 2026-10-07 QA: 옵션 자동코드 칸 예시가 행 순서 번호라, 교체된 기본 옵션이 쓰는 -01과 겹쳐 저장값과 달랐다. */
  it('빈 옵션 자동코드 칸은 저장 시 붙을 코드를 보이고, 예상할 수 없으면 저장 시 자동 생성만 보인다', () => {
    const rows = [
      { name: '빨강', code: '', attributes: { 색상: '빨강' }, extraPrice: 0, stockQty: 0 },
      { name: '파랑', code: '', attributes: { 색상: '파랑' }, extraPrice: 0, stockQty: 0 },
    ];
    const placeholders = (html: string) => [...html.matchAll(/aria-label="옵션 \d+ 옵션 자동코드"[^>]*placeholder="([^"]*)"/g)].map((match) => match[1]);
    const predicted = renderToStaticMarkup(<GoodsOptionEditor onRowsChange={() => {}} rows={rows} baseline={[savedA]} basePrice={10000}
      codePrefix="RIL-0001" savedCodes={{ goodCode: 'RIL-0001', options: [{ id: savedA, code: 'RIL-0001-01' }] }} />);
    expect(placeholders(predicted)).toEqual(['저장 시 자동 생성 · 예상 RIL-0001-02', '저장 시 자동 생성 · 예상 RIL-0001-03']);
    const unknown = renderToStaticMarkup(<GoodsOptionEditor onRowsChange={() => {}} rows={rows} baseline={[savedA]} basePrice={10000} codePrefix="RIL-0001" />);
    expect(placeholders(unknown)).toEqual(['저장 시 자동 생성', '저장 시 자동 생성']);
    const single = renderToStaticMarkup(<GoodsOptionEditor onRowsChange={() => {}} rows={[{ name: '기본 옵션', code: '', attributes: {}, extraPrice: 0, stockQty: 0 }]}
      baseline={[]} basePrice={10000} codePrefix="RIL-0002" savedCodes={{ goodCode: null, options: [] }} />);
    expect(single).toMatch(/id="goods-single-code"[^>]*placeholder="저장 시 자동 생성 · 예상 RIL-0002-01"/);
    expect(renderToStaticMarkup(<GoodsOptionEditor onRowsChange={() => {}} rows={[{ name: '기본 옵션', code: '', attributes: {}, extraPrice: 0, stockQty: 0 }]}
      baseline={[]} basePrice={10000} codePrefix="RIL-0002" />)).toMatch(/id="goods-single-code"[^>]*placeholder="저장 시 자동 생성"/);
  });

  it('옵션 입력은 기존 폼 이름을 유지하고, 옵션을 만들기 전의 옵션 있음 상태를 복구한다', () => {
    const html = renderToStaticMarkup(<GoodsOptionEditor onRowsChange={() => {}}
      rows={[{ name: '기본 옵션', code: '', attributes: {}, extraPrice: 0, stockQty: 0 }]}
      baseline={[]} basePrice={0}
      axisValues={{ optionUsage: 'on', optionAxisName0: '색상', optionAxisValues0: '빨강, 파랑', optionAxisName1: '', optionAxisValues1: '' }}
    />);
    expect(html).toMatch(/<input type="radio" name="optionUsage" checked="" value="on"\/>옵션 있음/);
    expect(html).toContain('name="optionAxisName0" value="색상"');
    expect(html).toContain('name="optionAxisValues0" value="빨강, 파랑"');
    /* 적어 둔 옵션값으로 무엇이 만들어지는지 바로 보이고, 버튼 이름이 그 결과다. */
    expect(html).toMatch(/<p[^>]*data-good-readback=""[^>]*>옵션 2개가 만들어집니다\(색상 2\)\.<\/p>/);
    expect(html).toMatch(/<button type="button"(?![^>]* disabled="")[^>]*data-good-option-create=""[^>]*>옵션 2개 만들기<\/button>/);
    expect(html).not.toContain('옵션목록으로 적용');
    expect(html).toMatch(/<p[^>]*data-good-option-empty=""[^>]*>아직 만든 옵션이 없습니다\. 지금 저장하면 옵션 없는 상품으로 저장됩니다\.<\/p>/);
    expect(html).toMatch(/<section[^>]*data-good-option-inputs=""/);
    expect(html).not.toMatch(/<section[^>]*data-good-option-inputs=""[^>]*hidden/);
  });

  /* 2026-11-25 '글보다 화면': [옵션목록으로 적용] 대신 적는 동안 결과를 보이고, 버튼은 누르면 일어나는 일을 말한다. */
  describe('옵션 만들기 버튼과 미리보기', () => {
    const red = { id: savedA, name: '빨강', code: 'GOOD-01', attributes: { 색상: '빨강' }, extraPrice: 0, stockQty: 4 };
    const blue = { id: savedB, name: '파랑', code: 'GOOD-02', attributes: { 색상: '파랑' }, extraPrice: 0, stockQty: 5 };
    const render = (axisValues: Record<string, string>, rows = [red, blue]) => renderToStaticMarkup(<GoodsOptionEditor onRowsChange={() => {}} rows={rows} baseline={[savedA, savedB]} basePrice={10000} axisValues={axisValues} />);
    const createButton = (html: string) => html.match(/<button type="button"[^>]*data-good-option-create=""[^>]*>[^<]*<\/button>/)?.[0] ?? '';

    it('지금 옵션목록과 같으면 누를 수 없고 바뀐 내용 없음으로 보인다', () => {
      const html = render({});
      expect(createButton(html)).toMatch(/ disabled=""[^>]*>바뀐 내용 없음<\/button>/);
      expect(html).toMatch(/data-good-readback=""[^>]*>지금 옵션목록과 같습니다\(색상 2\)\.<\/p>/);
    });

    it('옵션이 있는 상품은 몇 개가 되는지와 그대로·새로·빠짐을 보이고 버튼은 그 개수로 바꾸기다', () => {
      const html = render({ optionAxisName0: '색상', optionAxisValues0: '빨강, 초록', optionAxisName1: '사이즈', optionAxisValues1: '' });
      expect(html).toContain('옵션값 2를 적어 주세요.');
      expect(createButton(html)).toMatch(/ disabled=""[^>]*>옵션 만들기<\/button>/);
      const changed = render({ optionAxisName0: '색상', optionAxisValues0: '빨강, 초록, 노랑', optionAxisName1: '', optionAxisValues1: '' });
      expect(changed).toMatch(/data-good-readback=""[^>]*>옵션이 3개가 됩니다\(색상 3\) · 그대로 1개 · 새로 2개 · 빠짐 1개<\/p>/);
      expect(createButton(changed)).toMatch(/^<button type="button"(?![^>]* disabled="")[^>]*>옵션 3개로 바꾸기<\/button>$/);
    });

    it('100개를 넘으면 그 자리에서 지금 개수를 알리고 누를 수 없다', () => {
      const values = Array.from({ length: 11 }, (_, index) => `값${index}`).join(', ');
      const html = render({ optionAxisName0: '색상', optionAxisValues0: values, optionAxisName1: '사이즈', optionAxisValues1: values });
      expect(html).toMatch(/data-good-option-preview="over"[^>]*>옵션은 100개까지 만들 수 있습니다\. 지금 121개입니다\(색상 11 × 사이즈 11\)\.<\/p>/);
      expect(createButton(html)).toMatch(/ disabled=""[^>]*>옵션 만들기<\/button>/);
    });
  });
});

/* 규칙 5: 공개 중인 상품은 옵션 구성이 KC 검토 대상이라 서버가 변경을 거절한다. 열어 두고 저장 때 거절하지 않고 여기서 막는다. */
describe('공개 중 옵션 구성 잠금', () => {
  const rows = [
    { id: savedA, name: '빨강', code: 'LOCK-01', attributes: { 색상: '빨강' }, extraPrice: 0, stockQty: 3 },
    { id: savedB, name: '파랑', code: 'LOCK-02', attributes: { 색상: '파랑' }, extraPrice: 0, stockQty: 5 },
  ];
  const reason = '공개 중에는 옵션을 더하거나 빼거나 옵션 이름을 바꿀 수 없습니다.';
  const tag = (html: string, pattern: RegExp) => html.match(pattern)?.[0] ?? '';

  it('이유를 보이고 옵션 만들기·빼기·이름 바꾸기를 막되 재고수량·옵션가·사용여부는 열어 둔다', () => {
    const html = renderToStaticMarkup(<GoodsOptionEditor onRowsChange={() => {}} rows={rows} baseline={[savedA, savedB]} basePrice={1000} compositionLockedReason={reason} />);
    expect(html).toMatch(new RegExp(`data-good-option-composition-locked=""[^>]*>${reason}</p>`));
    expect(tag(html, /<fieldset[^>]*data-good-option-usage=""[^>]*>/)).toContain(' disabled=""');
    expect(tag(html, /<input[^>]*aria-label="옵션 1 이름"[^>]*>/)).toContain(' readOnly=""');
    expect(tag(html, /<button[^>]*aria-label="옵션 1 삭제"[^>]*>/)).toContain(' disabled=""');
    /* 재고수량·옵션가·사용여부는 공개 중에도 바꿀 수 있다. */
    for (const label of ['옵션 1 재고수량', '옵션 1 옵션가']) expect(tag(html, new RegExp(`<input[^>]*aria-label="${label}"[^>]*>`)), label).not.toMatch(/ (readOnly|disabled)=""/);
    expect(tag(html, /<select[^>]*aria-label="옵션 1 사용여부"[^>]*>/)).not.toContain(' disabled=""');
  });

  it('잠그지 않으면 이유가 없고 옵션 이름·삭제가 열려 있다', () => {
    const html = renderToStaticMarkup(<GoodsOptionEditor onRowsChange={() => {}} rows={rows} baseline={[savedA, savedB]} basePrice={1000} />);
    expect(html).not.toContain('data-good-option-composition-locked');
    expect(tag(html, /<input[^>]*aria-label="옵션 1 이름"[^>]*>/)).not.toContain(' readOnly=""');
    expect(tag(html, /<button[^>]*aria-label="옵션 1 삭제"[^>]*>/)).not.toContain(' disabled=""');
  });
});
