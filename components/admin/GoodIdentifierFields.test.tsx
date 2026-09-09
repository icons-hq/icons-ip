import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { GoodIdentifierFields } from './GoodIdentifierFields';
vi.mock('@/app/admin/goods-identifier-actions',()=>({suggestGoodsIdentifiersAction:vi.fn()}));
describe('상품코드와 URL 입력',()=>{
  it('상품코드와 옵션코드는 덮어쓸 수 있고 공개 이력이 있는 URL은 잠근다',()=>{
    const html=renderToStaticMarkup(<GoodIdentifierFields ipId="hwasan" name="키링" code="HW-0001" defaultVariantCode="HW-0001-01" slug="keyring" slugLocked errors={{}} />);
    expect(html).toContain('상품코드');
    expect(html).toContain('옵션코드');
    expect(html).toMatch(/<input(?=[^>]*name="id")(?=[^>]*readOnly)/);
    expect(html).toContain('value="HW-0001"');
    expect(html).toContain('한 번 공개한 URL은 변경할 수 없습니다.');
  });
  it('신규 상품은 코드와 URL을 비워두면 자동 생성한다고 안내한다',()=>{
    const html=renderToStaticMarkup(<GoodIdentifierFields ipId="hwasan" name="키링" errors={{}} />);
    expect(html).toContain('비워두면 자동 생성');
    expect(html).not.toContain('readOnly');
    expect(html).not.toContain('g100');
  });
});
