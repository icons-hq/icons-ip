import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import { CategoryFields, CategoryScreen } from './CategoryScreen';

const categories = [{
  id: '00000000-0000-4000-8000-000000047401', code: 'life', name: '생활', parentId: null, depth: 1, sortOrder: 1,
  archivedAt: null, updatedAt: '2026-09-10T00:00:00Z', childCount: 1, assignedGoodCount: 0,
}, {
  id: '00000000-0000-4000-8000-000000047402', code: 'paper', name: '문구', parentId: '00000000-0000-4000-8000-000000047401', depth: 2, sortOrder: 1,
  archivedAt: null, updatedAt: '2026-09-10T00:00:00Z', childCount: 0, assignedGoodCount: 2,
}];
const off = { customerEnabled: false, erpEnabled: false, customerEvidence: null, erpEvidence: null, updatedAt: null };
const render = (props: Partial<Parameters<typeof CategoryScreen>[0]> = {}) => renderToStaticMarkup(<CategoryScreen data={{ categories, mappings: [], activation: off }} {...props} />);
/** 접힌 카드(`<details>`) 하나의 마크업. */
const fold = (html: string, title: string) => html.match(new RegExp(`<details[^>]*data-fold-card=""[^>]*><summary[^>]*>(?:(?!</summary>)[\\s\\S])*${title}[\\s\\S]*?</details>`))?.[0] ?? '';

describe('CategoryScreen', () => {
  /* ADR-0044: 상품 유형 연결 칸·이름 기준 추천·목록의 유형 표기가 없고, 폼은 goodType 입력을 싣지 않는다. */
  it('카테고리 추가·수정 화면에 상품 유형 연결 칸이 없다', () => {
    const typed = categories.map((category) => ({ ...category, goodType: '피규어' }));
    const html = render({ data: { categories: typed, mappings: [], activation: off } });
    expect(html).not.toContain('name="goodType"');
    expect(html).not.toContain('data-category-good-type');
    expect(html).not.toContain('상품 유형 연결');
    expect(html).not.toContain('이름 기준 추천');
    expect(html).toContain('카테고리를 최대 4단계로 만들고 상품에 연결합니다. 상품은 대표 카테고리가 있어야 공개할 수 있습니다.');
  });

  it('links every category to its goods including descendants while public categories are disabled', () => {
    const html = render();
    expect(html).toContain('href="/admin/catalog/goods?status=active&amp;stock=all&amp;page=1&amp;categoryId=00000000-0000-4000-8000-000000047401"');
    expect(html).toContain('href="/admin/catalog/goods?status=active&amp;stock=all&amp;page=1&amp;categoryId=00000000-0000-4000-8000-000000047402"');
    expect(html).toContain('생활 상품 목록');
    expect(html).toContain('문구 상품 목록');
  });
});

it('basic category managers keep CRUD and assignment without platform configuration', () => {
  const html = render({ canManagePlatform: false });
  expect(html).toContain('카테고리 추가'); expect(html).toContain('대표 카테고리 바꾸기'); expect(html).toContain('카테고리 목록 내려받기');
  // kit 버튼은 type을 주지 않으면 button이 된다 — 서버 액션 폼의 제출 버튼은 submit이어야 한다.
  for (const label of ['저장', '카테고리 추가', '보관']) expect(html).toMatch(new RegExp(`<button(?=[^>]*type="submit")[^>]*>${label}</button>`));
  // 플랫폼 설정(고객 화면 스위치·ERP 코드)은 그 권한이 있을 때만 그린다.
  for (const text of ['고객 화면에 카테고리 보이기', '카테고리별 ERP 코드', 'id="category-erp-mapping"']) expect(html).not.toContain(text);
});

/* C-11: 누르면 일어나는 일을 말하는 이름. 화면에서 쓰지 않기로 한 말(낱말 표)이 남아 있지 않다. */
it('버튼·카드 이름이 하는 일을 말하고, 쓰지 않는 말이 없다', () => {
  const html = render({ data: { categories, mappings: [], activation: { ...off, customerEnabled: true } } });
  expect(html).toMatch(/<a[^>]*href="\/api\/admin\/categories\/export"[^>]*>(?:<svg[\s\S]*?<\/svg>)?카테고리 목록 내려받기<\/a>/);
  expect(html).toContain('카테고리 목록 2개');
  for (const word of ['CSV', '카테고리 트리', '매핑', '부모', '노출 순서', '활성', '분류 저장', '고객 category', 'ERP mapping']) expect(html, word).not.toContain(word);
});

/* C-01·C-04(규칙 1·8): 상품을 내부 값으로 적는 칸이 없다. 상품은 공용 상품 선택창으로 고른다. */
it('대표 카테고리 바꾸기는 상품을 적게 하지 않고 [상품 고르기]로 시작한다', () => {
  const html = render({ canManagePlatform: false });
  const card = html.slice(html.indexOf('aria-label="대표 카테고리 바꾸기"'));
  expect(card).toMatch(/<button[^>]*type="button"[^>]*>상품 고르기<\/button>/);
  expect(card).toContain('<input type="hidden" name="goodId" value=""/>');
  expect(card).not.toMatch(/<input(?![^>]*type="hidden")[^>]*name="goodId"/);
  expect(html).not.toContain('goods-id');
  expect(html).not.toContain('상품 ID');
  // 카드 하나에 이름 하나다(옛 이름: 상품 기본 카테고리 적용 / 대표 분류 저장).
  for (const old of ['기본 카테고리 적용', '대표 분류 저장']) expect(html).not.toContain(old);
});

/* C-02(가장 위험): 상품과 카테고리를 고르기 전에는 저장 버튼도, 카테고리 칸도, 지우는 버튼도 없다. */
it('상품을 고르기 전에는 대표 카테고리를 저장하거나 지울 수 없다', () => {
  const html = render({ canManagePlatform: false, hasCategoryTemplates: true });
  const card = html.slice(html.indexOf('aria-label="대표 카테고리 바꾸기"'));
  expect(card).not.toMatch(/<button[^>]*type="submit"/);
  expect(card).not.toContain('미분류로 되돌리기');
  expect(card).not.toContain('name="categoryId"');
  expect(card).not.toContain('자주 쓰는 카테고리');
});

it('고치는 항목 하나만 오른쪽에 열고 목록에 주 색으로 표시한다', () => {
  const html = render({ canManagePlatform: false });
  expect(html.match(/<button aria-current="true"/g)).toHaveLength(1);
  expect(html).toContain('생활 수정');
  expect(html).not.toContain('문구 수정');
  // 저장·추가는 각자 묶음의 주 행동이다.
  for (const label of ['저장', '카테고리 추가']) expect(html).toMatch(new RegExp(`<button(?=[^>]*bg-primary)[^>]*>${label}</button>`));
});

/* C-07: 순서를 숫자로 적는 칸 대신 고른 줄의 [위로]·[아래로]. 맨 위·맨 아래 줄은 그쪽 버튼이 눌리지 않는다. */
it('순서는 숫자 칸이 아니라 고른 줄의 위로·아래로 버튼으로 바꾼다', () => {
  const html = render({ canManagePlatform: false });
  expect(html).not.toMatch(/<input(?![^>]*type="hidden")[^>]*name="sortOrder"/);
  expect(html.match(/data-category-tree="move"/g)).toHaveLength(1);
  expect(html).toMatch(/<button[^>]*aria-label="생활 위로 옮기기"[^>]*disabled=""[^>]*title="위로"/);
  expect(html).toMatch(/<button[^>]*aria-label="생활 아래로 옮기기"[^>]*disabled=""[^>]*title="아래로"/);
  // 고치는 카테고리는 저장된 순서를 그대로, 새 카테고리는 고른 상위 아래 맨 끝(최상위 '생활' 다음)을 보낸다.
  expect(html).toContain('<input type="hidden" name="sortOrder" value="1"/>');
  expect(html).toContain('<input type="hidden" name="sortOrder" value="2"/>');
});

/* C-05(규칙 1·2): 상위 카테고리는 전체 드롭다운이 아니라 공용 선택창으로 고른다. 지금 값은 경로로 보인다. */
it('상위 카테고리는 드롭다운이 아니라 [상위 카테고리 고르기]로 고르고, 값은 숨은 칸이 싣는다', () => {
  const html = render({ canManagePlatform: false });
  expect(html).not.toContain('<select');
  expect(html.match(/>상위 카테고리 고르기<\/button>/g)).toHaveLength(2);
  // 새 카테고리는 상위가 없는 채로 시작한다.
  expect(html).toContain('placeholder="없음 (최상위 카테고리)"');
  expect(html).toContain('<input type="hidden" name="parentId" value=""/>');
  expect(html).not.toContain('>최상위로</button>');
  // 고치는 '생활'은 하위(문구)뿐이라 상위로 둘 곳이 없다: 버튼을 잠그고 이유를 적는다.
  expect(html).toMatch(/<button(?=[^>]*disabled="")[^>]*>상위 카테고리 고르기<\/button>/);
  expect(html.match(/지금 상위로 둘 수 있는 카테고리가 없습니다\./g)).toHaveLength(1);
});

it('상위가 있는 카테고리는 그 경로를 읽기 전용 칸에 보이고 [최상위로]를 둔다', () => {
  const [parent, child] = categories;
  const html = renderToStaticMarkup(<CategoryFields categories={categories} category={child} />);
  expect(html).toMatch(/<input[^>]*readOnly=""[^>]*value="생활"/);
  expect(html).toContain(`<input type="hidden" name="parentId" value="${parent.id}"/>`);
  expect(html).toMatch(/<button[^>]*type="button"[^>]*>최상위로<\/button>/);
  // 다른 상위로 옮기지 않는 한 저장된 순서를 그대로 보낸다.
  expect(html).toContain('<input type="hidden" name="sortOrder" value="1"/>');
  // 보관한 상위는 선택창에는 없지만, 지금 값이므로 '보관됨'과 함께 그대로 보인다(최상위인 것처럼 보이지 않는다).
  const archived = renderToStaticMarkup(<CategoryFields categories={[{ ...parent, archivedAt: '2026-10-01T00:00:00Z' }, child]} category={child} />);
  expect(archived).toMatch(/<input[^>]*readOnly=""[^>]*value="보관됨 · 생활"/);
  expect(archived).toContain(`<input type="hidden" name="parentId" value="${parent.id}"/>`);
});

/* 저장이 거절되면 React가 비제어 입력을 되돌린다. 적어 둔 값을 되살려 다시 적지 않게 한다. */
it('저장이 거절되면 적어 둔 이름·코드·상위 카테고리를 되살리고, 코드 칸을 열어 틀린 값을 보인다', () => {
  const [parent, child] = categories;
  const html = renderToStaticMarkup(<CategoryFields categories={categories} category={child}
    errors={{ code: '카테고리 코드는 영문 소문자·숫자·하이픈(-)만 쓰고, 영문이나 숫자로 시작해야 합니다. 80자까지 쓸 수 있습니다.' }}
    values={{ name: '문구류', code: '한글', parentId: '' }} />);
  expect(html).toMatch(/<input[^>]*name="name"[^>]*value="문구류"/);
  expect(html).toMatch(/<input(?![^>]*type="hidden")[^>]*name="code"[^>]*value="한글"/);
  expect(html).toContain('영문 소문자·숫자·하이픈(-)만 씁니다. 코드를 바꾸면 예전 코드가 적힌 상품 엑셀은 이 카테고리를 찾지 못합니다.');
  expect(html).toContain('<input type="hidden" name="parentId" value=""/>');
  // 상위를 최상위로 바꾼 상태다: 순서는 최상위 맨 끝(생활 다음)으로 보낸다.
  expect(html).toContain('<input type="hidden" name="sortOrder" value="2"/>');
  expect(html).toContain('role="alert"');
  expect(parent.sortOrder).toBe(1);
});

/* C-06: 카테고리 코드는 자동으로 만들어져 잠겨 있고, 정해 둔 코드가 있을 때만 [직접 바꾸기]로 연다. */
it('카테고리 코드는 잠겨 있다 — 새 카테고리는 자동 생성, 고치는 카테고리는 저장된 코드를 그대로 보낸다', () => {
  const html = render({ canManagePlatform: false });
  expect(html).not.toMatch(/<input(?![^>]*type="hidden")[^>]*name="code"/);
  expect(html).toContain('자동 생성 · 입력할 필요 없음');
  expect(html.match(/>직접 바꾸기<\/button>/g)).toHaveLength(2);
  expect(html).toContain('<input type="hidden" name="code" value="life"/>');
  expect(html).toContain('<input type="hidden" name="code" value=""/>');
  expect(html).not.toContain('카테고리 코드 (영문)');
});

/* C-12: 작업 번호는 서버가 누를 때마다 새로 만들던 죽은 칸이 아니라, 보내는 순간 화면이 만들어 넣는다(같은 폼을 두 번 보내도 한 번만 처리). */
it('폼마다 작업 번호 칸이 하나씩 있고, 늘 비어 있도록 고정돼 있지 않다', () => {
  const html = render();
  expect(html.match(/name="operationId"/g)!.length).toBeGreaterThanOrEqual(5);
  expect(html).not.toMatch(/<input[^>]*name="operationId"[^>]*readOnly/);
});

/* C-08·규칙 5: 지금 보관할 수 없는 카테고리는 버튼을 잠그고 풀 방법을 적는다. */
it('하위 카테고리가 있으면 보관 버튼을 잠그고 이유를 옆에 적는다', () => {
  const html = render({ canManagePlatform: false });
  expect(html).toMatch(/<button(?=[^>]*type="submit")(?=[^>]*disabled="")[^>]*>보관<\/button>/);
  expect(html).toContain('하위 카테고리를 먼저 보관하거나 다른 곳으로 옮겨야 보관할 수 있습니다.');
  const leafFirst = renderToStaticMarkup(<CategoryScreen canManagePlatform={false} data={{ categories: [{ ...categories[1], parentId: null, depth: 1 }], mappings: [], activation: off }} />);
  expect(leafFirst).toMatch(/<button(?=[^>]*type="submit")(?![^>]*disabled="")[^>]*>보관<\/button>/);
  expect(leafFirst).not.toContain('먼저 보관하거나');
});

it('카테고리 관리에서 `대>중>소` 경로를 붙여넣어 일괄 등록할 수 있다', () => {
  const html = render({ canManagePlatform: false });
  expect(html).toContain('카테고리 일괄 등록');
  expect(html).toContain('aria-label="카테고리 경로"');
  /* C-13: 적는 방식은 입력칸 예시가 보여 준다. 안내는 한 줄이고, 한 번에 넣을 수 있는 줄 수는 줄 수 옆에 있다. */
  expect(html).toContain('한 줄에 하나씩 ‘대&gt;중&gt;소’로 적습니다. 이미 있는 카테고리는 다시 만들지 않습니다.');
  expect(html).toContain('경로 0줄 · 한 번에 1,000줄까지');
  expect(html).not.toContain('같은 부모 아래');
});

it('한 화면의 저장은 고르는 항목 하나다 — 새 등록·ERP 코드·고객 화면 스위치는 접혀 있고, 목록 한 줄에는 단계 분수 대신 상품 수만 있다', () => {
  const html = render();
  for (const title of ['새 카테고리 등록', '카테고리별 ERP 코드', '고객 화면에 카테고리 보이기']) expect(html).toMatch(new RegExp(`<details[^>]*data-fold-card=""(?![^>]*open)[^>]*><summary[^>]*>(?:(?!</summary>)[\\s\\S])*${title}`));
  expect(html).toContain('>상품 2개</a>');
  expect(html).not.toMatch(/\d\/4/);
});

/* 결정 D3(2026-11-25): 근거 칸을 없앤다. 사용 설정은 켜기·끄기 하나다. */
describe('고객 화면에 카테고리 보이기', () => {
  it('꺼져 있으면 접힌 줄에 켜는 곳을 버튼 모양으로 알리고, 켜져 있으면 알리지 않는다', () => {
    expect(render()).toMatch(/<summary[^>]*>(?:(?!<\/summary>)[\s\S])*고객 화면에 카테고리 보이기(?:(?!<\/summary>)[\s\S])*꺼짐(?:(?!<\/summary>)[\s\S])*펼쳐서 켜기/);
    const on = render({ data: { categories, mappings: [], activation: { ...off, customerEnabled: true } } });
    expect(on).not.toContain('펼쳐서 켜기');
    expect(on).toMatch(/<summary[^>]*>(?:(?!<\/summary>)[\s\S])*고객 화면에 카테고리 보이기(?:(?!<\/summary>)[\s\S])*켜짐/);
  });

  it('근거 칸·체크박스 없이 지금 상태와 [켜기]·[끄기] 하나만 있고, 누르면 달라지는 것을 한 줄로 적는다', () => {
    const closed = fold(render(), '고객 화면에 카테고리 보이기');
    expect(closed).toContain('지금 고객 화면에는 카테고리가 보이지 않습니다.');
    expect(closed).toMatch(/<button(?=[^>]*type="submit")(?![^>]*disabled="")[^>]*>켜기<\/button>/);
    expect(closed).toContain('<input type="hidden" name="customerEnabled" value="on"/>');
    expect(closed).toContain('켜면 고객 화면에 바로 반영됩니다.');
    const opened = fold(render({ data: { categories, mappings: [], activation: { ...off, customerEnabled: true } } }), '고객 화면에 카테고리 보이기');
    expect(opened).toContain('지금 고객 화면에 카테고리가 보입니다.');
    expect(opened).toMatch(/<button(?=[^>]*type="submit")[^>]*>끄기<\/button>/);
    expect(opened).toContain('<input type="hidden" name="customerEnabled" value=""/>');
    expect(opened).toContain('끄면 고객 화면에서 카테고리 메뉴가 바로 사라집니다. 상품은 그대로 판매됩니다.');
    for (const html of [closed, opened]) {
      for (const gone of ['근거', '출처', '참조', '검증 시각', 'type="checkbox"', 'type="datetime-local"', 'Evidence', 'ERP']) expect(html, gone).not.toContain(gone);
      expect(html.match(/<input(?![^>]*type="hidden")/g) ?? []).toHaveLength(0);
    }
  });

  /* "?"는 이 화면에서 이 한 곳뿐이다(조사 문서가 꼽은 칸). */
  it('"?" 도움말은 고객 화면 스위치 한 곳에만 단다', () => {
    const html = render();
    expect(html.match(/data-admin-help=""/g)).toHaveLength(1);
    expect(fold(html, '고객 화면에 카테고리 보이기')).toContain('aria-label="고객 화면에 카테고리 보이기 도움말"');
  });

  it('카테고리가 하나도 없으면 켜기를 잠그고 먼저 할 일을 적는다', () => {
    const empty = fold(render({ data: { categories: [], mappings: [], activation: off } }), '고객 화면에 카테고리 보이기');
    expect(empty).toMatch(/<button(?=[^>]*type="submit")(?=[^>]*disabled="")[^>]*>켜기<\/button>/);
    expect(empty).toContain('카테고리가 하나 이상 있어야 켤 수 있습니다. 아래에서 카테고리를 먼저 등록해주세요.');
  });

  /* 화면에 스위치가 없는 ERP 분류 값(읽는 곳이 없다)은 저장돼 있던 대로 실어 보낸다. 그 값 때문에 고객 화면 스위치가 잠기지는 않는다. */
  it('저장돼 있던 ERP 분류 값은 그대로 실어 보내고, ERP 코드가 빈 카테고리가 있으면 끈 값으로 보내 저장이 막히지 않게 한다', () => {
    const mapped = [{ categoryId: categories[1].id, erpCode: 'ERP-1', erpName: '문구', source: null, verifiedAt: null, verifiedBy: null }];
    const kept = fold(render({ data: { categories, mappings: mapped, activation: { ...off, erpEnabled: true } } }), '고객 화면에 카테고리 보이기');
    expect(kept).toContain('<input type="hidden" name="erpEnabled" value="on"/>');
    /* DB는 ERP 분류가 켜져 있으면 마지막 단계 카테고리마다 ERP 코드를 요구한다(category_activation_unready). */
    const missing = fold(render({ data: { categories, mappings: [], activation: { ...off, erpEnabled: true } } }), '고객 화면에 카테고리 보이기');
    expect(missing).toContain('<input type="hidden" name="erpEnabled" value=""/>');
    expect(missing).toMatch(/<button(?=[^>]*type="submit")(?![^>]*disabled="")[^>]*>켜기<\/button>/);
    expect(fold(render(), '고객 화면에 카테고리 보이기')).toContain('<input type="hidden" name="erpEnabled" value=""/>');
  });
});

/* 2026-11-10 측정: 마지막 단계 300개면 ERP 입력 묶음만 DOM 4,500개였다. 접혀 있는 동안은 그리지 않는다. */
it('카테고리별 ERP 코드 입력 표는 펼치기 전에는 그리지 않고 안내만 둔다', () => {
  const leaf = (index: number) => ({ ...categories[1], id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, code: `leaf-${index}`, name: `말단 ${index}` });
  const many = [categories[0], ...Array.from({ length: 300 }, (_, index) => leaf(index))];
  const html = render({ data: { categories: many, mappings: [], activation: off } });
  expect(html).toContain('마지막 단계 300개 · ERP 코드 없음 300개');
  expect(html).not.toContain('name="erpCode"');
  expect(html.match(/<[a-z][^>]*>/g)!.length).toBeLessThan(4_000);
});

/* 2026-11-10 사람 눈 시험: 카테고리마다 카드 한 장이라 펼치면 페이지가 10만 px까지 길어지고 검색이 없었다. */
it('카테고리별 ERP 코드는 여기 적은 값이 어디에 쓰이는지와 ERP 품목 화면의 연결 표와의 관계를 한 문단으로 알려 준다', () => {
  const html = render();
  const card = fold(html, '카테고리별 ERP 코드');
  expect(html).toContain('id="category-erp-mapping"');
  expect(card).toContain('마지막 단계 1개 · ERP 코드 없음 1개');
  expect(card).toContain('여기 적은 ERP 코드·품명은 [카테고리 목록 내려받기] 파일에 실립니다. ERP 품목의 분류 이름과 같게 적어 두면');
  expect(card).toContain('에서 그 분류가 이 카테고리에 자동으로 연결됩니다.');
  expect(card).toContain('href="/admin/catalog/erp-items#erp-category-mapping"');
  expect(card).toContain('ERP 품목 화면의 연결 표');
  expect(card.match(/<p /g)).toHaveLength(1);
  for (const gone of ['출처', '검증 시각', '근거', '짐작한 값']) expect(card, gone).not.toContain(gone);
});

it('카테고리가 없으면 새 등록 카드를 펼쳐 둔다', () => {
  const html = render({ canManagePlatform: false, data: { categories: [], mappings: [], activation: off } });
  expect(html).toMatch(/<details[^>]*data-fold-card=""[^>]*open=""[^>]*><summary[^>]*>(?:(?!<\/summary>)[\s\S])*새 카테고리 등록/);
  expect(html).toContain('등록된 카테고리가 없습니다.');
  // 고를 곳이 없는 선택창은 열 수 없다. 버튼이 왜 잠겼는지도 적는다.
  expect(html).toMatch(/<button(?=[^>]*disabled="")[^>]*>상위 카테고리 고르기<\/button>/);
  expect(html).toContain('다른 카테고리가 없어 최상위 카테고리로 둡니다.');
});

/* QA: 카테고리가 하나뿐일 때 그 카테고리를 고치는 칸의 [상위 카테고리 고르기]가 이유 없이 흐렸다. */
it('카테고리가 하나뿐이면 상위로 둘 곳이 없다는 것을 잠긴 버튼 아래에 적는다', () => {
  const html = render({ canManagePlatform: false, data: { categories: [categories[1]].map((category) => ({ ...category, parentId: null, depth: 1 })), mappings: [], activation: off } });
  expect(html).toMatch(/<button(?=[^>]*disabled="")[^>]*>상위 카테고리 고르기<\/button>/);
  /* 고치는 칸: 자기 말고 다른 카테고리가 없다. */
  expect(html.match(/다른 카테고리가 없어 최상위 카테고리로 둡니다\./g)).toHaveLength(1);
  /* 새 카테고리 칸: 하나 있는 카테고리에 상품이 연결돼 있어 그 아래에는 둘 수 없다 — 이쪽은 전부터 이유를 적었다. */
  expect(html.match(/지금 상위로 둘 수 있는 카테고리가 없습니다\./g)).toHaveLength(1);
});
