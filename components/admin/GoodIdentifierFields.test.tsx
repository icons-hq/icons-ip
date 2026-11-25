import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { GoodIdentifierFields } from './GoodIdentifierFields';
vi.mock('@/app/admin/goods-identifier-actions',()=>({suggestGoodsIdentifiersAction:vi.fn()}));
const inputOf=(html:string,name:string)=>html.match(new RegExp(`<input(?=[^>]*name="${name}")[^>]*>`))?.[0] ?? '';
describe('상품 자동코드와 고객 화면 주소',()=>{
  /* 2026-11-19 MD가 바코드를 옛 '판매자상품코드' 칸에 넣었다(ADR-0048). 시스템이 만드는 코드는 기본으로 잠그고 자동 생성임을 보인다. */
  it('상품 자동코드·옵션 자동코드는 기본으로 잠그고 자동 생성이라 입력할 필요가 없다고 알린다',()=>{
    const html=renderToStaticMarkup(<GoodIdentifierFields ipId="hwasan" name="키링" code="HW-0001" defaultVariantCode="HW-0001-01" slug="keyring" errors={{}} />);
    expect(html).toContain('상품 자동코드');
    expect(html).toContain('옵션 자동코드');
    for (const name of ['code','defaultVariantCode']) expect(inputOf(html,name),name).toContain('readOnly');
    expect(inputOf(html,'code')).toContain('value="HW-0001"');
    expect(html.match(/자동 생성 · 입력할 필요 없음/g)).toHaveLength(2);
    expect(html.match(/>직접 바꾸기<\/button>/g)).toHaveLength(2);
    /* 잠겨 있을 때는 입력할 것이 없다 — 어디에 쓰이는지 한 줄만 말하고, 바코드·ERP 코드 안내는 칸을 열 때만 보인다. */
    expect(html).toContain('출고지시 엑셀의 &#x27;상품코드&#x27; 열에 찍히고 고객 화면 주소 끝에도 쓰입니다.');
    expect(html).not.toContain('바코드·ERP 코드는');
    for (const old of ['판매자상품코드','관리코드','기본 양식']) expect(html).not.toContain(old);
  });
  /* MD-0051·ADR-0050 — 예전 'URL' 칸의 로마자 값(내부 id)은 주소가 아니다. 고객 화면 주소는 상품 자동코드로 정해져 읽기 전용으로 보이고,
     내부 id는 숨은 값으로 지금 그대로 보내 저장 계약을 지킨다. */
  it('고객 화면 주소를 상품 자동코드로 보이고 내부 id는 입력·표시하지 않고 그대로 보낸다',()=>{
    const html=renderToStaticMarkup(<GoodIdentifierFields ipId="hwasan" name="키링" code="HSQ-0059" defaultVariantCode="HSQ-0059-01" slug="hongsilkweseuteu-akeuril-hyudaepon-kiring" errors={{}} />);
    expect(html).toContain('고객 화면 주소');
    expect(html).toContain('<input type="hidden" name="id" value="hongsilkweseuteu-akeuril-hyudaepon-kiring"/>');
    const address=html.match(/<input(?=[^>]*id="good-identifier-id")[^>]*>/)?.[0] ?? '';
    expect(address).toContain('readOnly');
    expect(address).toContain('value="xsquare.kr/shop/hsq-0059"');
    expect(address).not.toContain('name=');
    expect(html.match(/hongsilkweseuteu/g)).toHaveLength(1);
    /* 주소가 바뀐다는 경고는 상품 자동코드를 직접 바꿀 때만 보인다(잠겨 있으면 입력할 것이 없다). */
    expect(html).not.toContain('바꾸기 전 주소로 들어온 고객');
    expect(html).not.toContain('id="id-help"');
    for (const old of ['한 번 공개한 URL은 변경할 수 없습니다.','비워두면 상품명에서 자동 생성합니다.']) expect(html).not.toContain(old);
  });
  it('신규 상품은 예상 코드와 함께 저장 시 자동 생성을 보이고 주소도 저장할 때 정해진다고 알린다',()=>{
    const html=renderToStaticMarkup(<GoodIdentifierFields ipId="hwasan" name="키링" errors={{}} />);
    expect(inputOf(html,'code')).toContain('readOnly');
    expect(inputOf(html,'code')).toContain('placeholder="저장 시 자동 생성"');
    expect(html).toContain('<input type="hidden" name="id" value=""/>');
    expect(html).toContain('value="저장할 때 상품 자동코드로 정해집니다"');
    expect(html).not.toContain('g100');
  });
  it('상품 자동코드가 옛 값(내부 id의 대문자)이어도 코드 주소로 보고 쓸 수 없다고 하지 않는다',()=>{
    const html=renderToStaticMarkup(<GoodIdentifierFields ipId="hwasan" name="키링" code="G13" slug="g13" errors={{}} />);
    expect(html).toContain('value="xsquare.kr/shop/g13"');
    expect(html).not.toContain('주소로 쓸 수 없는 글자');
  });
  it('주소에 쓸 수 없는 글자가 든 상품 자동코드면 처음 저장한 영문 값 주소를 보이고 이유를 알린다',()=>{
    const html=renderToStaticMarkup(<GoodIdentifierFields ipId="hwasan" name="키링" code="창고 A-1" slug="keyring" errors={{}} />);
    expect(html).toContain('value="xsquare.kr/shop/keyring"');
    expect(html).toContain('상품 자동코드에 주소로 쓸 수 없는 글자(공백·한글·기호)가 있어, 처음 저장할 때 정해진 영문 값으로 열립니다.');
  });
  it('잠긴 자동코드 칸에 바코드 형식 값이 들어 있으면 막지 않고 바코드 칸과 직접 바꾸기를 안내한다',()=>{
    const html=renderToStaticMarkup(<GoodIdentifierFields ipId="hwasan" name="키링" code="8800353088562" defaultVariantCode="8800353086155" errors={{}} />);
    expect(inputOf(html,'code')).toContain('value="8800353088562"');
    expect(inputOf(html,'code')).toContain('aria-describedby="code-help code-barcode"');
    expect(inputOf(html,'code')).not.toContain('aria-invalid="true"');
    expect(html.match(/data-good-code-barcode-warning/g)).toHaveLength(2);
    expect(html).toContain('이 값은 상품 목록과 출고지시 엑셀의 &#x27;상품코드&#x27; 열에 찍힙니다.');
    expect(html).toContain('출고지시 엑셀의 &#x27;옵션코드&#x27; 열에 찍힙니다.');
    expect(html).toContain('바코드는 옵션 상세 정보의 바코드 칸에 넣고, 이 칸은 &#x27;직접 바꾸기&#x27;를 눌러 고칩니다.');
    for (const old of ['판매자상품코드','관리코드']) expect(html).not.toContain(old);
  });
  it('자동코드·창고 품번처럼 바코드가 아닌 값에는 경고하지 않는다',()=>{
    const html=renderToStaticMarkup(<GoodIdentifierFields ipId="hwasan" name="키링" code="HSQ-0060" defaultVariantCode="00012345" errors={{}} />);
    expect(html).not.toContain('data-good-code-barcode-warning');
  });
  it('저장 오류가 난 자동코드 칸은 고칠 수 있게 열어 둔다',()=>{
    const html=renderToStaticMarkup(<GoodIdentifierFields ipId="hwasan" name="키링" code="8801234567890" errors={{code:'상품 자동코드는 100자 이내로 입력해주세요.'}} />);
    expect(inputOf(html,'code')).not.toContain('readOnly');
    expect(html).toContain('직접 바꾸는 중');
    expect(html).toContain('>자동코드로 두기</button>');
    expect(html).toContain('창고 품번처럼 정해진 코드가 있거나 잘못 들어간 값을 고칠 때만 바꿉니다.');
    /* 칸을 열면 바코드·ERP 코드를 넣을 곳과, 코드를 바꾸면 고객 화면 주소도 바뀐다는 결과를 말한다. */
    expect(html).toContain('바코드·ERP 코드는 여기에 넣지 않고, 옵션 상세 정보의 바코드·ERP 코드 칸에 넣습니다.');
    expect(html).toContain('상품 자동코드를 바꾸면 이 주소도 바뀌어, 바꾸기 전 주소로 들어온 고객은 상품을 찾지 못합니다.');
    expect(html).toContain('id="id-help"');
  });
});
