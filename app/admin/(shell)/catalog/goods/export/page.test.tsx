import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ guard: vi.fn(), parts: vi.fn(), names: vi.fn() }));
vi.mock('@/lib/admin/guard.server', () => ({ requireAdminScreenAccess: mocks.guard }));
vi.mock('@/lib/admin/goods-import.server', () => ({ loadGoodsExportParts: mocks.parts }));
vi.mock('@/lib/admin/goods-export-names.server', () => ({ loadGoodsExportNames: mocks.names }));
import Page from './page';

const render = async (params: Record<string, string> = {}) => renderToStaticMarkup(await Page({ searchParams: Promise.resolve(params) }));
const plain = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.guard.mockResolvedValue({ user: { id: 'staff' } });
  mocks.names.mockResolvedValue({ ip: '메이플스토리' });
  mocks.parts.mockResolvedValue({ parts: [['g1', 'g2']], totalGoods: 2, totalRows: 5 });
});

describe('상품 엑셀 내보내기 화면', () => {
  it('내보내기 권한을 먼저 확인하고, 그 전에는 상품도 이름도 읽지 않는다', async () => {
    mocks.guard.mockRejectedValue(new Error('forbidden'));
    await expect(render()).rejects.toThrow('forbidden');
    expect(mocks.guard).toHaveBeenCalledWith('/admin/catalog/goods/export');
    expect(mocks.parts).not.toHaveBeenCalled();
    expect(mocks.names).not.toHaveBeenCalled();
  });

  it('걸린 조건을 한 줄로 되읽어 준다(E-01)', async () => {
    const html = await render({ ipId: 'maple', stock: 'out_of_stock' });
    expect(mocks.parts).toHaveBeenCalledWith(expect.objectContaining({ ipId: 'maple', stock: 'out_of_stock', status: 'active' }));
    expect(mocks.names).toHaveBeenCalledWith(expect.objectContaining({ ipId: 'maple' }));
    expect(html).toMatch(/data-goods-export="conditions"/);
    expect(plain(html)).toContain('검색 조건 보관 제외 · IP 메이플스토리 · 품절');
  });

  it('파일이 하나면 번호 없이 [엑셀 파일 내려받기] 버튼 하나와 상품·줄 수를 보인다', async () => {
    const html = await render({ ipId: 'maple' });
    expect(plain(html)).toContain('2개 상품 · 옵션 5줄');
    expect(html.match(/mode=export&amp;part=/g)).toHaveLength(1);
    expect(html).toContain('part=1&amp;');
    expect(plain(html)).toContain('엑셀 파일 내려받기');
    expect(plain(html)).not.toContain('1번 파일');
    expect(plain(html)).not.toContain('나누었습니다');
  });

  it('파일이 여럿이면 번호와 상품 수로 구분하고 왜 나뉘는지 한 문장으로 말한다', async () => {
    mocks.parts.mockResolvedValue({ parts: [['g1', 'g2', 'g3'], ['g4']], totalGoods: 4, totalRows: 620 });
    const html = await render();
    expect(plain(html)).toContain('4개 상품 · 옵션 620줄');
    expect(plain(html)).toContain('1번 파일 내려받기 · 3개 상품');
    expect(plain(html)).toContain('2번 파일 내려받기 · 1개 상품');
    expect(plain(html)).toContain('한 파일에 500줄까지만 담을 수 있어 나누었습니다. 같은 상품의 옵션은 한 파일에 함께 들어갑니다.');
    expect(html).toContain('part=2&amp;');
  });

  it('맞는 상품이 없으면 조건은 그대로 보이고, 고칠 방법을 말한다', async () => {
    mocks.parts.mockResolvedValue({ parts: [], totalGoods: 0, totalRows: 0 });
    const html = await render({ q: '없는 상품' });
    expect(plain(html)).toContain('검색 조건 보관 제외 · 검색어 “없는 상품”');
    expect(plain(html)).toContain('검색 조건에 맞는 상품이 없습니다. [상품 목록]에서 조건을 바꿔주세요.');
    expect(html).not.toContain('mode=export');
    expect(plain(html)).not.toContain('0개 상품');
  });

  it('내려받는 주소는 목록의 조건을 그대로 들고 간다', async () => {
    const html = await render({ ipId: 'maple', stock: 'low', q: '머그' });
    const href = /href="(\/api\/admin\/goods-workbook\?[^"]+)"/.exec(html)?.[1].replace(/&amp;/g, '&') ?? '';
    const params = new URLSearchParams(href.split('?')[1]);
    expect(params.get('mode')).toBe('export');
    expect(params.get('part')).toBe('1');
    expect(params.get('ipId')).toBe('maple');
    expect(params.get('stock')).toBe('low');
    expect(params.get('q')).toBe('머그');
  });

  it('옛 이름(행·필터·게시·해당)을 쓰지 않는다(E-02)', async () => {
    const text = plain(await render());
    for (const stale of ['행', '필터', '게시', '해당']) expect(text, stale).not.toContain(stale);
    mocks.parts.mockResolvedValue({ parts: [], totalGoods: 0, totalRows: 0 });
    const empty = plain(await render());
    for (const stale of ['행', '필터', '게시', '해당']) expect(empty, stale).not.toContain(stale);
  });
});
