import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { GoodIdentifierFields } from './GoodIdentifierFields';
vi.mock('@/app/admin/goods-identifier-actions',()=>({suggestGoodsIdentifiersAction:vi.fn()}));
const inputOf=(html:string,name:string)=>html.match(new RegExp(`<input(?=[^>]*name="${name}")[^>]*>`))?.[0] ?? '';
describe('상품 자동코드와 URL 입력',()=>{
  /* 2026-11-19 MD가 바코드를 옛 '판매자상품코드' 칸에 넣었다(ADR-0048). 시스템이 만드는 코드는 기본으로 잠그고 자동 생성임을 보인다. */
  it('상품 자동코드·옵션 자동코드는 기본으로 잠그고 자동 생성이라 입력할 필요가 없다고 알린다',()=>{
    const html=renderToStaticMarkup(<GoodIdentifierFields ipId="hwasan" name="키링" code="HW-0001" defaultVariantCode="HW-0001-01" slug="keyring" slugLocked errors={{}} />);
    expect(html).toContain('상품 자동코드');
    expect(html).toContain('옵션 자동코드');
    for (const name of ['code','defaultVariantCode','id']) expect(inputOf(html,name),name).toContain('readOnly');
    expect(inputOf(html,'code')).toContain('value="HW-0001"');
    expect(html.match(/자동 생성 · 입력할 필요 없음/g)).toHaveLength(2);
    expect(html.match(/>직접 바꾸기<\/button>/g)).toHaveLength(2);
    expect(html).toContain('바코드·ERP 코드는 여기에 넣지 않습니다.');
    expect(html).toContain('출고지시 엑셀(기본 양식)의 &#x27;상품코드&#x27; 열에 찍힙니다.');
    expect(html).toContain('한 번 공개한 URL은 변경할 수 없습니다.');
    for (const old of ['판매자상품코드','관리코드']) expect(html).not.toContain(old);
  });
  it('신규 상품은 예상 코드와 함께 저장 시 자동 생성을 보이고 상품 URL만 입력할 수 있다',()=>{
    const html=renderToStaticMarkup(<GoodIdentifierFields ipId="hwasan" name="키링" errors={{}} />);
    expect(inputOf(html,'code')).toContain('readOnly');
    expect(inputOf(html,'code')).toContain('placeholder="저장 시 자동 생성"');
    expect(inputOf(html,'id')).not.toContain('readOnly');
    expect(html).toContain('비워두면 상품명에서 자동 생성합니다.');
    expect(html).not.toContain('g100');
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
  });
});
